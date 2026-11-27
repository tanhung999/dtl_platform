"""Seed DT HRM's default roles and permissions in the Platform registry."""

from sqlalchemy import select

from app.db.applications import (
    Application,
    ApplicationPermission,
    ApplicationRole,
    ApplicationRolePermission,
)


# Snapshot of DT HRM at 4534465 (SQL migrations through 044 and the default seed).
HRM_PERMISSIONS = {
    "hrm.access.manage": "Quản lý tài khoản & phân quyền",
    "hrm.attendance.approve": "Duyệt điều chỉnh công",
    "hrm.attendance.calculate": "Tính lại bảng công hàng loạt",
    "hrm.attendance.exception_resolve": "Xử lý ngoại lệ chấm công",
    "hrm.attendance.read": "Xem công toàn công ty",
    "hrm.attendance.web.manage": "Quản lý quyền và vùng chấm công web",
    "hrm.attendance_period.close": "Thực hiện chốt bảng công theo kỳ",
    "hrm.attendance_period.export": "Xuất dữ liệu bảng công kỳ ra tệp Excel/CSV",
    "hrm.attendance_period.read": "Xem danh sách kỳ công, trạng thái và bảng công",
    "hrm.attendance_period.reopen": "Mở lại kỳ công đã chốt để điều chỉnh và tạo revision mới",
    "hrm.attendance_period.review": "Xác nhận hoặc từ chối bảng công cấp dưới theo phạm vi quản lý",
    "hrm.attendance_period.self": "Xem tóm tắt bảng công kỳ của chính mình",
    "hrm.audit.read": "Xem nhật ký kiểm toán",
    "hrm.blacklist.approve": "Phê duyệt danh sách đen",
    "hrm.blacklist.manage": "Tạo và cập nhật đề xuất danh sách đen",
    "hrm.blacklist.match": "Kiểm tra cảnh báo danh sách đen",
    "hrm.blacklist.read": "Xem chi tiết hồ sơ danh sách đen",
    "hrm.contract_renewal.approve": "Phê duyệt đề xuất gia hạn hợp đồng lao động",
    "hrm.contract_renewal.read": "Xem danh sách hợp đồng sắp hết hạn và đề xuất gia hạn",
    "hrm.contract_renewal.request": "Tạo đề xuất gia hạn hợp đồng lao động",
    "hrm.contracts.read": "Xem hợp đồng & tài liệu",
    "hrm.contracts.write": "Quản lý hợp đồng & tài liệu",
    "hrm.dashboard.read": "Xem tổng quan",
    "hrm.delegation.manage": "Quản lý ủy quyền Trưởng phòng Nhân sự",
    "hrm.employees.read": "Xem toàn bộ nhân viên",
    "hrm.employees.write": "Quản lý hồ sơ nhân viên",
    "hrm.jobs.manage": "Theo dõi, thử lại và hủy tác vụ nền hệ thống",
    "hrm.leave.approve": "Duyệt nghỉ phép",
    "hrm.leave.manage": "Quản lý chính sách & cấp phép",
    "hrm.leave.read": "Xem nghỉ phép toàn công ty",
    "hrm.lifecycle.apply": "Áp dụng thay đổi nhân sự có hiệu lực",
    "hrm.lifecycle.approve": "Phê duyệt thay đổi nhân sự",
    "hrm.lifecycle.read": "Xem lịch sử và yêu cầu biến động nhân sự",
    "hrm.lifecycle.request": "Đề xuất thay đổi nhân sự",
    "hrm.manager_scope.view": "Xem dữ liệu công và phép theo phạm vi quản lý",
    "hrm.offboarding.approve": "Phê duyệt đề xuất thôi việc nhân sự",
    "hrm.offboarding.read": "Xem danh sách và tiến độ các ca thôi việc nhân sự",
    "hrm.offboarding.request": "Tạo đề xuất thôi việc hoặc tiếp nhận đơn xin nghỉ việc",
    "hrm.offboarding.task": "Thực hiện nhiệm vụ bàn giao, thu hồi tài sản và hủy quyền",
    "hrm.onboarding.manage": "Khởi tạo và điều phối quy trình tiếp nhận nhân sự mới",
    "hrm.onboarding.read": "Xem tiến độ và hồ sơ các ca tiếp nhận nhân sự",
    "hrm.onboarding.task": "Thực hiện và xác nhận nhiệm vụ tiếp nhận nhân sự",
    "hrm.organization.write": "Quản lý cơ cấu & ca làm",
    "hrm.overtime.confirm": "Đối soát và xác nhận số phút OT hợp lệ trước khi chốt công",
    "hrm.overtime.policy.manage": "Cấu hình chính sách và hạn mức làm thêm giờ theo phiên bản",
    "hrm.overtime.request": "Tạo và quản lý yêu cầu làm thêm giờ (OT) cá nhân hoặc cấp dưới",
    "hrm.overtime.review": "Phê duyệt hoặc từ chối yêu cầu OT theo phạm vi quản lý",
    "hrm.overtime.self": "Xem lịch làm việc, yêu cầu đổi ca và giờ làm thêm cá nhân",
    "hrm.probation.decide": "Ra quyết định công nhận chính thức, gia hạn hoặc kết thúc thử việc",
    "hrm.probation.read": "Xem quá trình và danh sách nhân sự thử việc",
    "hrm.probation.review": "Thực hiện đánh giá thử việc nhân sự theo thẩm quyền quản lý",
    "hrm.recruitment.evaluate": "Đánh giá phỏng vấn ứng viên",
    "hrm.recruitment.manage": "Quản lý tin tuyển dụng, ứng viên và quy trình",
    "hrm.recruitment.offer": "Quản lý và phê duyệt đề xuất tuyển dụng",
    "hrm.recruitment.read": "Xem danh sách và tổng quan tuyển dụng",
    "hrm.reports.read": "Xem các báo cáo quản trị nhân sự",
    "hrm.retention.manage": "Quản lý bảo lưu dữ liệu (Legal Hold) và retention",
    "hrm.roster.manage": "Tạo, điều chỉnh và sao chép lịch phân ca nháp",
    "hrm.roster.publish": "Phát hành (publish) và thay thế (supersede) bảng phân ca chính thức",
    "hrm.roster.read": "Xem lịch phân ca phòng ban và công ty",
    "hrm.salary.apply.execute": "Thực thi áp dụng hiệu lực điều chỉnh lương",
    "hrm.salary.apply.preview": "Kiểm tra trước áp dụng hiệu lực điều chỉnh lương (Dry-run)",
    "hrm.salary.approve": "Phê duyệt điều chỉnh lương nhân viên",
    "hrm.salary.components.manage": "Quản lý danh mục thành phần thu nhập",
    "hrm.salary.director_approve": "Phê duyệt điều chỉnh lương cấp Ban Giám đốc",
    "hrm.salary.read": "Xem thông tin lương cán bộ nhân viên",
    "hrm.salary.request": "Đề xuất điều chỉnh lương nhân viên",
    "hrm.salary.request.override": "Hủy hoặc gửi lại đề xuất điều chỉnh lương thay người tạo",
    "hrm.salary.self": "Xem tóm tắt thông tin lương của chính mình",
    "hrm.salary.workflow.override": "Quản trị viên phê duyệt thay thế bước duyệt lương",
    "hrm.self.service": "Chấm công, nghỉ phép & hồ sơ cá nhân",
    "hrm.shift_swap.manage": "Điều phối và xử lý ngoại lệ đổi ca toàn công ty",
    "hrm.shift_swap.request": "Tạo và quản lý yêu cầu đổi ca làm việc cá nhân",
    "hrm.shift_swap.review": "Phê duyệt hoặc từ chối yêu cầu đổi ca cấp dưới theo phạm vi quản lý",
    "hrm.sources.manage": "Quản lý nguồn chấm công",
    "hrm.workflow.self": "Xem và cập nhật các nhiệm vụ quy trình của bản thân",
    "hrm.workflow_template.manage": "Tạo lập, điều chỉnh và công bố mẫu quy trình",
    "hrm.workflow_template.read": "Xem danh sách và cấu hình mẫu quy trình vòng đời nhân sự",
}

HRM_ROLES = {
    "admin": (
        "Quản trị viên",
        (
            "hrm.access.manage", "hrm.attendance.approve", "hrm.attendance.calculate",
            "hrm.attendance.exception_resolve", "hrm.attendance.read", "hrm.attendance.web.manage",
            "hrm.attendance_period.close", "hrm.attendance_period.export",
            "hrm.attendance_period.read", "hrm.attendance_period.reopen",
            "hrm.attendance_period.review", "hrm.attendance_period.self", "hrm.audit.read",
            "hrm.blacklist.approve", "hrm.blacklist.manage", "hrm.blacklist.match",
            "hrm.blacklist.read", "hrm.contract_renewal.approve", "hrm.contract_renewal.read",
            "hrm.contract_renewal.request", "hrm.contracts.read", "hrm.contracts.write",
            "hrm.dashboard.read", "hrm.delegation.manage", "hrm.employees.read",
            "hrm.employees.write", "hrm.jobs.manage", "hrm.leave.approve", "hrm.leave.manage",
            "hrm.leave.read", "hrm.lifecycle.apply", "hrm.lifecycle.approve", "hrm.lifecycle.read",
            "hrm.lifecycle.request", "hrm.manager_scope.view", "hrm.offboarding.approve",
            "hrm.offboarding.read", "hrm.offboarding.request", "hrm.offboarding.task",
            "hrm.onboarding.manage", "hrm.onboarding.read", "hrm.onboarding.task",
            "hrm.organization.write", "hrm.overtime.confirm", "hrm.overtime.policy.manage",
            "hrm.overtime.request", "hrm.overtime.review", "hrm.overtime.self",
            "hrm.probation.decide", "hrm.probation.read", "hrm.probation.review",
            "hrm.recruitment.evaluate", "hrm.recruitment.manage", "hrm.recruitment.offer",
            "hrm.recruitment.read", "hrm.reports.read", "hrm.retention.manage", "hrm.roster.manage",
            "hrm.roster.publish", "hrm.roster.read", "hrm.salary.apply.execute",
            "hrm.salary.apply.preview", "hrm.salary.approve", "hrm.salary.components.manage",
            "hrm.salary.read", "hrm.salary.request", "hrm.salary.request.override", "hrm.salary.self",
            "hrm.salary.workflow.override", "hrm.self.service", "hrm.shift_swap.manage",
            "hrm.shift_swap.request", "hrm.shift_swap.review", "hrm.sources.manage",
            "hrm.workflow.self", "hrm.workflow_template.manage", "hrm.workflow_template.read",
        ),
    ),
    "board": (
        "Ban Điều hành / Hội đồng",
        (
            "hrm.dashboard.read", "hrm.salary.apply.preview", "hrm.salary.approve",
            "hrm.salary.director_approve", "hrm.salary.read", "hrm.salary.self",
        ),
    ),
    "director": (
        "Giám đốc / Ban Điều hành",
        (
            "hrm.dashboard.read", "hrm.salary.apply.preview", "hrm.salary.approve",
            "hrm.salary.director_approve", "hrm.salary.read", "hrm.salary.self",
        ),
    ),
    "employee": (
        "Nhân viên",
        (
            "hrm.attendance_period.self", "hrm.dashboard.read", "hrm.offboarding.task",
            "hrm.onboarding.task", "hrm.overtime.request", "hrm.overtime.self", "hrm.salary.self",
            "hrm.self.service", "hrm.shift_swap.request", "hrm.workflow.self",
        ),
    ),
    "hr": (
        "Nhân sự",
        (
            "hrm.attendance.approve", "hrm.attendance.calculate", "hrm.attendance.exception_resolve",
            "hrm.attendance.read", "hrm.attendance.web.manage", "hrm.attendance_period.close",
            "hrm.attendance_period.export", "hrm.attendance_period.read",
            "hrm.attendance_period.reopen", "hrm.attendance_period.review",
            "hrm.attendance_period.self", "hrm.audit.read", "hrm.blacklist.approve",
            "hrm.blacklist.manage", "hrm.blacklist.match", "hrm.blacklist.read",
            "hrm.contract_renewal.approve", "hrm.contract_renewal.read",
            "hrm.contract_renewal.request", "hrm.contracts.read", "hrm.contracts.write",
            "hrm.dashboard.read", "hrm.employees.read", "hrm.employees.write", "hrm.leave.approve",
            "hrm.leave.manage", "hrm.leave.read", "hrm.lifecycle.apply", "hrm.lifecycle.approve",
            "hrm.lifecycle.read", "hrm.lifecycle.request", "hrm.manager_scope.view",
            "hrm.offboarding.approve", "hrm.offboarding.read", "hrm.offboarding.request",
            "hrm.offboarding.task", "hrm.onboarding.manage", "hrm.onboarding.read",
            "hrm.onboarding.task", "hrm.organization.write", "hrm.overtime.confirm",
            "hrm.overtime.policy.manage", "hrm.overtime.request", "hrm.overtime.review",
            "hrm.overtime.self", "hrm.probation.decide", "hrm.probation.read", "hrm.probation.review",
            "hrm.recruitment.evaluate", "hrm.recruitment.manage", "hrm.recruitment.offer",
            "hrm.recruitment.read", "hrm.reports.read", "hrm.roster.manage", "hrm.roster.publish",
            "hrm.roster.read", "hrm.salary.read", "hrm.salary.request", "hrm.salary.self",
            "hrm.self.service", "hrm.shift_swap.manage", "hrm.shift_swap.request",
            "hrm.shift_swap.review", "hrm.sources.manage", "hrm.workflow.self",
            "hrm.workflow_template.manage", "hrm.workflow_template.read",
        ),
    ),
    "hr_head": (
        "Trưởng phòng Nhân sự",
        (
            "hrm.attendance.approve", "hrm.attendance.calculate", "hrm.attendance.exception_resolve",
            "hrm.attendance.read", "hrm.attendance.web.manage", "hrm.attendance_period.close",
            "hrm.attendance_period.export", "hrm.attendance_period.read",
            "hrm.attendance_period.reopen", "hrm.attendance_period.review",
            "hrm.attendance_period.self", "hrm.audit.read", "hrm.blacklist.approve",
            "hrm.blacklist.manage", "hrm.blacklist.match", "hrm.blacklist.read",
            "hrm.contract_renewal.approve", "hrm.contract_renewal.read",
            "hrm.contract_renewal.request", "hrm.contracts.read", "hrm.contracts.write",
            "hrm.dashboard.read", "hrm.delegation.manage", "hrm.employees.read",
            "hrm.employees.write", "hrm.leave.approve", "hrm.leave.manage", "hrm.leave.read",
            "hrm.lifecycle.apply", "hrm.lifecycle.approve", "hrm.lifecycle.read",
            "hrm.lifecycle.request", "hrm.manager_scope.view", "hrm.offboarding.approve",
            "hrm.offboarding.read", "hrm.offboarding.request", "hrm.offboarding.task",
            "hrm.onboarding.manage", "hrm.onboarding.read", "hrm.onboarding.task",
            "hrm.organization.write", "hrm.overtime.confirm", "hrm.overtime.policy.manage",
            "hrm.overtime.request", "hrm.overtime.review", "hrm.overtime.self",
            "hrm.probation.decide", "hrm.probation.read", "hrm.probation.review",
            "hrm.recruitment.evaluate", "hrm.recruitment.manage", "hrm.recruitment.offer",
            "hrm.recruitment.read", "hrm.reports.read", "hrm.retention.manage", "hrm.roster.manage",
            "hrm.roster.publish", "hrm.roster.read", "hrm.salary.apply.preview", "hrm.salary.approve",
            "hrm.salary.components.manage", "hrm.salary.read", "hrm.salary.request",
            "hrm.salary.self", "hrm.self.service", "hrm.shift_swap.manage", "hrm.shift_swap.request",
            "hrm.shift_swap.review", "hrm.sources.manage", "hrm.workflow.self",
            "hrm.workflow_template.manage", "hrm.workflow_template.read",
        ),
    ),
    "manager": (
        "Quản lý",
        (
            "hrm.attendance_period.read", "hrm.attendance_period.review",
            "hrm.attendance_period.self", "hrm.contract_renewal.read", "hrm.contract_renewal.request",
            "hrm.dashboard.read", "hrm.lifecycle.read", "hrm.lifecycle.request",
            "hrm.manager_scope.view", "hrm.offboarding.read", "hrm.offboarding.request",
            "hrm.offboarding.task", "hrm.onboarding.read", "hrm.onboarding.task",
            "hrm.overtime.request", "hrm.overtime.review", "hrm.overtime.self", "hrm.probation.read",
            "hrm.probation.review", "hrm.recruitment.evaluate", "hrm.reports.read", "hrm.roster.read",
            "hrm.salary.self", "hrm.self.service", "hrm.shift_swap.request", "hrm.shift_swap.review",
            "hrm.workflow.self", "hrm.workflow_template.read",
        ),
    ),
}


async def migrate_hrm_authorization(conn) -> None:
    app_key = "hrm"
    if not await conn.scalar(select(Application.key).where(Application.key == app_key)):
        raise RuntimeError("Register the HRM application before seeding its authorization catalog.")

    existing_permissions = await conn.execute(
        select(ApplicationPermission.code, ApplicationPermission.id)
        .where(ApplicationPermission.application_key == app_key)
    )
    permission_ids = {code: permission_id for code, permission_id in existing_permissions}
    new_permissions = []
    for order, (code, label) in enumerate(HRM_PERMISSIONS.items()):
        if code in permission_ids:
            continue
        permission_id = f"{app_key}:{code}"
        permission_ids[code] = permission_id
        new_permissions.append({
            "id": permission_id,
            "application_key": app_key,
            "code": code,
            "display_name": label,
            "sort_order": order,
        })

    if new_permissions:
        await conn.execute(ApplicationPermission.__table__.insert(), new_permissions)

    existing_roles = await conn.scalars(
        select(ApplicationRole.key).where(ApplicationRole.application_key == app_key)
    )
    existing_role_keys = set(existing_roles)

    # Existing roles may have been imported and customized before this upgrade.
    for order, (key, (label, codes)) in enumerate(HRM_ROLES.items()):
        if key in existing_role_keys:
            continue
        role_id = f"{app_key}:{key}"
        await conn.execute(ApplicationRole.__table__.insert().values(
            id=role_id,
            application_key=app_key,
            key=key,
            display_name=label,
            sort_order=order,
        ))
        if codes:
            await conn.execute(ApplicationRolePermission.__table__.insert(), [
                {"role_id": role_id, "permission_id": permission_ids[code]}
                for code in codes
            ])
