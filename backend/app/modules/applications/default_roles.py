"""Business defaults must not depend on a role's display order or database ID."""
from fastapi import HTTPException

DEFAULT_ROLE_KEYS = {'workflows': 'USER', 'bookingreports': 'sales', 'itam': 'Nhan_Vien_HC'}


def default_role(application_key, roles):
    key = DEFAULT_ROLE_KEYS.get(application_key)
    if key is None:
        return roles[0] if roles else None
    role = next((item for item in roles if item.key == key), None)
    if role is None:
        raise HTTPException(409, 'Ứng dụng chưa có vai trò mặc định phù hợp. Hãy kiểm tra danh mục vai trò trước khi cấp quyền.')
    return role
