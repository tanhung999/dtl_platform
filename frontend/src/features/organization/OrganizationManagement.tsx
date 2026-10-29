import { FormEvent, useEffect, useRef, useState } from "react";
import { requestWithTimeout } from "../../services/requestTimeout";
type Item = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  rank?: number;
  department_id?: string;
  job_level_id?: string;
  is_management?: boolean;
  reports_to_level_id?: string | null;
  report_to_level_ids?: string[];
};
type Catalog = { departments: Item[]; job_levels: Item[]; positions: Item[]; work_locations: Item[] };
export function OrganizationManagement() {
  const [data, setData] = useState<Catalog>({
      departments: [],
      job_levels: [],
      positions: [],
      work_locations: [],
    }),
    [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [busy, setBusy] = useState(false), [deletingId, setDeletingId] = useState<string>();
  const [success, setSuccess] = useState("");
  const submitting = useRef(false);
  const [kind, setKind] = useState<"departments" | "job-levels" | "positions" | "work-locations">(
    "departments",
  );
  const [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [department, setDepartment] = useState(""),
    [level, setLevel] = useState(""),
    [rank, setRank] = useState(100),
    [isManagement, setIsManagement] = useState(false),
    [reportToLevels, setReportToLevels] = useState<string[]>([]);
  const load = () =>
    requestWithTimeout<Catalog>("/api/admin/organization")
      .then(setData);
  useEffect(() => {
    void load().catch(e => setError(e.message));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setSuccess("");
    try {
      await requestWithTimeout(`/api/admin/organization/${kind}${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          code,
          is_active: true,
          rank,
          department_id: department || null,
          job_level_id: level || null,
          is_management: isManagement,
          reports_to_level_id: reportToLevels[0] || null,
          report_to_level_ids: reportToLevels,
        }),
      });
      setSuccess(editingId ? "Đã lưu thay đổi thành công." : "Đã thêm thành công.");
      setName("");
      setCode("");
      setEditingId(undefined);
      setReportToLevels([]);
      await load().catch(() => { setSuccess(""); setError("Dữ liệu đã được lưu, nhưng chưa tải lại được danh sách. Hãy tải lại trang để xem cập nhật."); });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false; setBusy(false);
    }
  };
  const items =
    kind === "departments"
      ? data.departments
      : kind === "job-levels"
        ? data.job_levels
        : kind === "positions" ? data.positions : data.work_locations;
  return (
    <section className="admin-card organization-admin">
      <div className="organization-tabs">
        {(
          [
            ["departments", "Phòng ban"],
            ["positions", "Vị trí"],
            ["job-levels", "Cấp bậc"],
            ["work-locations", "Nơi làm việc"],
          ] as const
        ).map((x) => (
          <button
            type="button"
            disabled={busy}
            key={x[0]}
            className={`btn btn-sm ${kind === x[0] ? "btn-secondary" : "btn-outline"}`}
            onClick={() => { setKind(x[0]); setEditingId(undefined); setName(""); setCode(""); setReportToLevels([]); setError(""); setSuccess(""); }}
          >
            {x[1]}
          </button>
        ))}
      </div>
      <form onSubmit={submit} aria-busy={busy} className={`organization-form is-${kind}`}>
        <input
          className="form-input"
          placeholder="Mã"
          disabled={busy}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <input
          className="form-input"
          placeholder="Tên"
          disabled={busy}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {kind === "positions" && (
          <>
            <select
              className="form-input"
              value={department}
              disabled={busy}
              onChange={(e) => setDepartment(e.target.value)}
              required
            >
              <option value="">Chọn phòng ban</option>
              {data.departments
                .filter((x) => x.is_active)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
            <select
              className="form-input"
              value={level}
              disabled={busy}
              onChange={(e) => setLevel(e.target.value)}
              required
            >
              <option value="">Chọn cấp bậc</option>
              {data.job_levels
                .filter((x) => x.is_active)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </>
        )}
        {kind === "job-levels" && (
          <>
            <label className="organization-rank-field"><span>Thứ tự (số nhỏ hơn là cấp cao hơn)</span><input className="form-input" type="number" value={rank} disabled={busy} onChange={(e) => setRank(Number(e.target.value))}/></label>
            <label className="organization-manager-check"><input type="checkbox" checked={isManagement} disabled={busy} onChange={e=>setIsManagement(e.target.checked)}/><span>Đây là cấp quản lý</span></label>
            <details className="organization-report-picker">
              <summary>{reportToLevels.length ? `${reportToLevels.length} cấp quản lý được phép` : "Không có cấp quản lý phía trên"}</summary>
              <div>{data.job_levels.filter(x=>x.is_active&&x.is_management&&x.id!==editingId).map(x=><label key={x.id}><input type="checkbox" checked={reportToLevels.includes(x.id)} disabled={busy} onChange={e=>setReportToLevels(current=>e.target.checked?[...current,x.id]:current.filter(id=>id!==x.id))}/><span>{x.name} · Bậc {x.rank}</span></label>)}{!data.job_levels.some(x=>x.is_active&&x.is_management&&x.id!==editingId)&&<p>Chưa có cấp quản lý phù hợp.</p>}</div>
            </details>
          </>
        )}
        <button disabled={busy} className="btn btn-primary organization-add-button">{busy && !deletingId ? "Đang lưu…" : editingId ? "Lưu" : "Thêm"}</button>
        {editingId && <button type="button" disabled={busy} className="btn btn-outline btn-sm" onClick={()=>{setEditingId(undefined);setName("");setCode("");setReportToLevels([]);setError("");setSuccess("");}}>Hủy</button>}
      </form>
      {success && <p className="access-success" role="status">{success}</p>}
      {error && <p className="alert-error" role="alert">{error}</p>}
      <div className="organization-list">
        {!error && items.length === 0 && (
          <p className="organization-empty">Chưa có dữ liệu trong nhóm này.</p>
        )}
        {items.map((item) => (
          <div key={item.id}>
            <strong>{item.name}</strong>
            <span>
              {item.code}
              {item.rank != null ? ` · Bậc ${item.rank}` : ""}
              {item.is_management ? " · Quản lý" : item.rank != null ? " · Nhân viên" : ""}
              {item.department_id ? ` · ${data.departments.find(x=>x.id===item.department_id)?.name || "Phòng ban"}` : ""}
              {item.job_level_id ? ` · ${data.job_levels.find(x=>x.id===item.job_level_id)?.name || "Cấp bậc"}` : ""}
              {item.report_to_level_ids?.length ? ` · Báo cáo cho ${item.report_to_level_ids.map(id=>data.job_levels.find(x=>x.id===id)?.name).filter(Boolean).join(", ")}` : ""}
            </span>
            <div className="organization-item-actions"><button type="button" disabled={busy} className="btn btn-outline btn-sm" onClick={()=>{
              setError("");setSuccess("");
              setEditingId(item.id);setName(item.name);setCode(item.code);setRank(item.rank??100);setDepartment(item.department_id??"");setLevel(item.job_level_id??"");setIsManagement(Boolean(item.is_management));setReportToLevels(item.report_to_level_ids??(item.reports_to_level_id?[item.reports_to_level_id]:[]));
            }}>Sửa</button><button type="button" disabled={busy} className="btn btn-danger-outline btn-sm" onClick={async () => {
                if (submitting.current) return;
                submitting.current = true; setBusy(true); setDeletingId(item.id); setError(""); setSuccess("");
                try {
                  await requestWithTimeout(
                    `/api/admin/organization/${kind}/${item.id}`,
                    { method: "DELETE" },
                  );
                  setSuccess("Đã xóa thành công.");
                  if (editingId === item.id) { setEditingId(undefined); setName(""); setCode(""); setReportToLevels([]); }
                  await load().catch(() => { setSuccess(""); setError("Dữ liệu đã được xóa, nhưng chưa tải lại được danh sách. Hãy tải lại trang để xem cập nhật."); });
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  submitting.current = false; setBusy(false); setDeletingId(undefined);
                }
              }}>{deletingId === item.id ? "Đang xóa…" : "Xóa"}</button></div>
          </div>
        ))}
      </div>
    </section>
  );
}
