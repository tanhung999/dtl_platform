"""Explicit operator commands; never run automatically during application startup.

database: create an isolated database/role in the existing PostgreSQL instance.
provision USERNAME: link an existing Platform user to a newly created Keycloak user.
"""
import argparse
import asyncio
import getpass
import os
import re

import asyncpg
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.core.database import async_session_maker, engine
from app.db.models import User
# The standalone CLI does not import app.main, which normally registers these FK targets.
from app.db import organization  # noqa: F401
from app.modules.users.keycloak import keycloak_user_admin


class IdentitySetupError(ValueError):
    """Safe operator-facing error when a remote identity needs reconciliation."""


def identifier(value):
    if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', value):
        raise ValueError('Database/user name must use lowercase letters, numbers and underscores.')
    return '"' + value + '"'


async def prepare_database():
    url = make_url(settings.DATABASE_URL)
    if url.get_backend_name() != 'postgresql':
        raise ValueError('This command requires PostgreSQL.')
    name, username = os.getenv('KEYCLOAK_DB_NAME', 'keycloak'), os.getenv('KEYCLOAK_DB_USER', 'keycloak')
    name_sql, user_sql = identifier(name), identifier(username)
    password = os.environ.get('KEYCLOAK_DB_PASSWORD', '')
    if name == url.database or username == url.username or len(password) < 32:
        raise ValueError('Use a separate database/user and a password of at least 32 characters.')
    connection = dict(host=url.host, port=url.port or 5432, user=url.username, password=url.password,
                      database=url.database, timeout=10)
    db = await asyncpg.connect(**connection)
    try:
        role = await db.fetchrow('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname=$1', username)
        if role:
            if any(role):
                raise ValueError('Existing Keycloak role has elevated privileges; refusing to reuse it.')
        else:
            literal = "'" + password.replace("'", "''") + "'"
            await db.execute(f'CREATE ROLE {user_sql} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD {literal}')
        owner = await db.fetchval('SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=$1', name)
        if owner is not None and owner != username:
            raise ValueError('Existing database has another owner; no changes made to its ownership.')
        if owner is None:
            await db.execute(f'CREATE DATABASE {name_sql} OWNER {user_sql}')
        # Verify the supplied credentials; do not silently rotate an existing role password.
        target = await asyncpg.connect(**{**connection, 'user': username, 'password': password, 'database': name})
        try:
            await target.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
        finally:
            await target.close()
        await db.execute(f'REVOKE ALL ON DATABASE {name_sql} FROM PUBLIC')
        # Separate databases provide logical, not process/resource isolation.
        print('Keycloak database and restricted role are ready. Platform data was not changed.')
    finally:
        await db.close()


async def provision_user(username, password):
    async with async_session_maker() as db:
        user = await db.scalar(select(User).where(User.username == username.strip().lower()).with_for_update())
        if not user:
            raise ValueError('Platform user does not exist.')
        if user.identity_subject:
            raise ValueError('User already has an identity_subject; refusing to overwrite it.')
        if not 8 <= len(password) <= 128:
            raise ValueError('Password must have between 8 and 128 characters.')
        subject = await keycloak_user_admin.create_user(username=user.username, email=user.email,
            full_name=user.full_name, password=password, enabled=user.is_active)
        user_id = user.id
        try:
            user.identity_subject = subject
            await db.commit()
        except Exception as exc:
            # A lost COMMIT reply does not prove the database rolled back. Never
            # delete the Keycloak user until a new connection confirms no link.
            try:
                await db.rollback()
                async with async_session_maker() as verify:
                    linked_id = await verify.scalar(select(User.id).where(User.identity_subject == subject))
            except Exception:
                raise IdentitySetupError('Cannot verify the account link. Keep the Keycloak account and reconcile before retrying.') from exc
            if linked_id == user_id:
                print('Identity link confirmed after interrupted reply. Existing data is unchanged.')
                return
            if linked_id is None:
                await keycloak_user_admin.delete_user(subject)
            else:
                raise IdentitySetupError('Identity is linked to another Platform account; manual reconciliation is required.') from exc
            raise
        print('Identity linked. Platform user ID, permissions and business data are unchanged.')


async def execute(command, username=None, password=None):
    try:
        if command == 'database':
            await prepare_database()
        else:
            await provision_user(username, password)
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('database')
    provision = sub.add_parser('provision')
    provision.add_argument('username')
    args = parser.parse_args()
    try:
        if args.command == 'database':
            asyncio.run(execute('database'))
        else:
            password = getpass.getpass('New Keycloak password (not shown): ')
            if password != getpass.getpass('Confirm password: '):
                raise ValueError('Passwords do not match.')
            asyncio.run(execute('provision', args.username, password))
    except HTTPException as exc:
        parser.exit(1, str(exc.detail) + '\n')
    except ValueError as exc:
        parser.exit(1, str(exc) + '\n')
    except Exception as exc:
        # Database/HTTP exceptions may include credentials or SQL; never dump them.
        parser.exit(1, type(exc).__name__ + ': setup failed; verify connectivity and configuration.\n')


if __name__ == '__main__':
    main()
