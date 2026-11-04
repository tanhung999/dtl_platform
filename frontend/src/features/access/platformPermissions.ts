export const platformPermissions = [
  { code: 'access.assignments.manage', name: 'Quản trị Platform', description: 'Toàn quyền quản lý tài khoản, cơ cấu tổ chức, phân quyền và ứng dụng.', group: 'admin' },
  { code: 'calendar.share.manage', name: 'Chia sẻ lịch cá nhân', description: 'Chọn người được xem lịch và những mục muốn chia sẻ.', group: 'workspace' },
  { code: 'tasks.assign', name: 'Giao công việc', description: 'Giao việc trong phòng ban hiện tại hoặc các phòng ban được chọn.', group: 'workspace' },
] as const;

export const permissionNames = Object.fromEntries(platformPermissions.map(item => [item.code, item.name]));
