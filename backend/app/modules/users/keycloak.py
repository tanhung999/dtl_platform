"""Minimal Keycloak Admin REST client authenticated by a service account."""

import asyncio
import time
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from app.core.config import settings


class KeycloakUserAdmin:
    def __init__(self) -> None:
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()

    @property
    def ready(self) -> bool:
        return bool(settings.KEYCLOAK_ADMIN_CLIENT_SECRET)

    def _realm_url(self, suffix: str) -> str:
        base = settings.KEYCLOAK_ADMIN_BASE_URL.rstrip('/')
        realm = quote(settings.KEYCLOAK_ADMIN_REALM, safe='')
        return f'{base}/admin/realms/{realm}{suffix}'

    async def _access_token(self) -> str:
        if not self.ready:
            raise HTTPException(503, 'Platform chưa cấu hình tài khoản dịch vụ quản trị Keycloak.')
        if self._token and time.monotonic() < self._token_expires_at:
            return self._token
        async with self._token_lock:
            if self._token and time.monotonic() < self._token_expires_at:
                return self._token
            url = (
                settings.KEYCLOAK_ADMIN_BASE_URL.rstrip('/')
                + '/realms/' + quote(settings.KEYCLOAK_ADMIN_REALM, safe='')
                + '/protocol/openid-connect/token'
            )
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    response = await client.post(url, data={
                        'grant_type': 'client_credentials',
                        'client_id': settings.KEYCLOAK_ADMIN_CLIENT_ID,
                        'client_secret': settings.KEYCLOAK_ADMIN_CLIENT_SECRET,
                    })
            except httpx.HTTPError as exc:
                raise HTTPException(503, 'Không thể kết nối dịch vụ định danh Keycloak.') from exc
            if response.status_code != 200:
                raise HTTPException(503, 'Keycloak từ chối tài khoản dịch vụ quản trị người dùng.')
            payload = response.json()
            self._token = payload['access_token']
            self._token_expires_at = time.monotonic() + max(int(payload.get('expires_in', 60)) - 15, 5)
            return self._token

    async def _request(self, method: str, suffix: str, *, json: dict | None = None) -> httpx.Response:
        token = await self._access_token()
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.request(
                    method,
                    self._realm_url(suffix),
                    headers={'Authorization': f'Bearer {token}'},
                    json=json,
                )
        except httpx.HTTPError as exc:
            raise HTTPException(503, 'Không thể đồng bộ tài khoản với Keycloak.') from exc
        if response.status_code == 401:
            self._token = None
        return response

    async def create_user(self, *, username: str, email: str, full_name: str, password: str, enabled: bool = True) -> str:
        first_name, last_name = self._name_parts(full_name)
        response = await self._request('POST', '/users', json={
            'username': username,
            'email': email,
            'firstName': first_name,
            'lastName': last_name,
            'enabled': enabled,
            'emailVerified': True,
            'credentials': [{'type': 'password', 'value': password, 'temporary': False}],
        })
        if response.status_code == 409:
            raise HTTPException(409, 'Tên đăng nhập hoặc email đã tồn tại trên hệ thống định danh.')
        if response.status_code == 400:
            raise HTTPException(422, 'Keycloak từ chối thông tin tài khoản. Kiểm tra email, tên đăng nhập và chính sách mật khẩu.')
        if response.status_code != 201:
            raise HTTPException(502, 'Keycloak không thể tạo tài khoản.')
        location = response.headers.get('location', '').rstrip('/')
        subject = location.rsplit('/', 1)[-1]
        if not subject:
            raise HTTPException(502, 'Keycloak không trả về mã định danh tài khoản.')
        return subject

    async def update_user(self, subject: str, *, email: str, full_name: str, enabled: bool) -> None:
        first_name, last_name = self._name_parts(full_name)
        response = await self._request('PUT', f'/users/{quote(subject, safe="")}', json={
            'email': email,
            'firstName': first_name,
            'lastName': last_name,
            'enabled': enabled,
            'emailVerified': True,
        })
        if response.status_code == 409:
            raise HTTPException(409, 'Email đã được sử dụng trên hệ thống định danh.')
        if response.status_code == 404:
            raise HTTPException(409, 'Tài khoản không còn tồn tại trên Keycloak.')
        if response.status_code != 204:
            raise HTTPException(502, 'Keycloak không thể cập nhật tài khoản.')

    @staticmethod
    def _name_parts(full_name: str) -> tuple[str, str]:
        parts = full_name.strip().split()
        first_name = parts[0]
        # Realm dtl yêu cầu cả firstName và lastName. Tài khoản có tên một từ
        # nếu thiếu lastName sẽ bị Keycloak chặn với resolve_required_actions.
        last_name = ' '.join(parts[1:]) or first_name
        return first_name, last_name

    async def reset_password(self, subject: str, password: str) -> None:
        response = await self._request(
            'PUT', f'/users/{quote(subject, safe="")}/reset-password',
            json={'type': 'password', 'value': password, 'temporary': False},
        )
        if response.status_code == 404:
            raise HTTPException(409, 'Tài khoản không còn tồn tại trên Keycloak.')
        if response.status_code == 400:
            raise HTTPException(422, 'Mật khẩu không đáp ứng chính sách Keycloak. Dùng tối thiểu 8 ký tự và không trùng tên đăng nhập.')
        if response.status_code != 204:
            raise HTTPException(502, 'Keycloak không thể đặt lại mật khẩu.')

    async def logout_user(self, subject: str) -> None:
        response = await self._request('POST', f'/users/{quote(subject, safe="")}/logout')
        if response.status_code not in (204, 404):
            raise HTTPException(502, 'Keycloak không thể thu hồi phiên đăng nhập.')

    async def delete_user(self, subject: str) -> None:
        response = await self._request('DELETE', f'/users/{quote(subject, safe="")}')
        if response.status_code not in (204, 404):
            raise HTTPException(502, 'Keycloak không thể hoàn tác tài khoản vừa tạo.')


keycloak_user_admin = KeycloakUserAdmin()
