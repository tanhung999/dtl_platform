# Kiểm thử máy chủ

Chạy từ thư mục `backend`.

```text
tests/
  integration/   API, quyền sở hữu, giao dịch, nâng cấp, phiên bản và truy vấn
  postgres/      Kiểm tra đặc thù PostgreSQL, chạy riêng
  support/       ApiTestCase: SQLite cô lập, tài khoản và tiện ích gửi yêu cầu ASGI
```

```sh
python -m unittest discover -s tests -q
python -m unittest discover -s tests/integration -p test_notifications.py -v
```

Bộ kiểm thử tích hợp dùng SQLite trong bộ nhớ và thay thế phiên cơ sở dữ liệu được cấp cho API. Dữ liệu và tiện ích kiểm thử chung nằm ở `support/api_case.py`; các bộ kiểm thử không còn nhập bộ kiểm thử khác để dùng chung tiện ích. Lệnh tự tìm kiểm thử không tự chạy kịch bản PostgreSQL.

Kiểm tra PostgreSQL trên Docker:

```sh
docker compose exec -T -e PYTHONPATH=/app platform-backend python tests/postgres/notifications_postgres_check.py
docker compose exec -T -e PYTHONPATH=/app platform-backend python tests/postgres/realtime_versions_check.py
docker compose exec -T -e PYTHONPATH=/app platform-backend python tests/postgres/utc_datetime_check.py
```

Kịch bản PostgreSQL tạo lược đồ riêng với tên chứa UUID và dọn lược đồ trong `finally`. Sau khi đổi tệp kiểm thử trên máy chạy Docker, dựng lại ảnh container máy chủ trước khi chạy trong container vì mã nguồn không được gắn trực tiếp.

Riêng tư Task/Notes: `tests.integration.test_item_privacy` kiểm tra mặc định, quyền API, danh sách/số đếm/chi tiết chia sẻ, đồng bộ lịch hẹn và migration dữ liệu cũ.

Đổi hạn/dời lịch: `tests.integration.test_rescheduling` kiểm tra phiên bản, gửi lại yêu cầu, lý do/lịch sử riêng tư, đồng bộ Notes, nhắc hạn và hoàn tác. Thời gian không hợp lệ phải trả 422 và không ghi lịch sử.

Dọn dữ liệu và lịch sử form cũ: `tests.integration.test_schedule_history_and_retention`. PostgreSQL: `tests/postgres/maintenance_realtime_check.py`, `tests/postgres/retention_plan_check.py`; kiểm tra NOTIFY theo lô, tranh chấp worker, giữ job đang chờ và receipt. Các bài PostgreSQL tạo schema UUID riêng hoặc bảng TEMP rồi tự dọn.
