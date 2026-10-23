# DT product branding

The dashboard, navigation, login and module headings use the DT product names. Existing API IDs and SSO permissions stay `bookingreports`, `workflows`, and `itam`.

## Icon assets

- `frontend/src/assets/dt-brand-icons.png`: transparent 3 × 3 atlas, prepared with the built-in imagegen tool using the supplied brand sheet as reference.
- `frontend/src/assets/featureIcons.ts`: atlas cell mapping.
- `frontend/src/components/FeatureIcon.tsx`: shared renderer, including circular clipping of the atlas cells.
- `frontend/src/assets/icon-tasks.png`: existing task artwork retained for DT Task.
- `frontend/public/icon-platform.png`: platform favicon.

Atlas rows, left to right:

1. DT Platform, DT Assets, DT Workflow.
2. DT Link, DT Income Statement, DT My Note.
3. DT Calendar, DT HRM, DT Sales Commission.

DT HRM and DT Sales Commission are reserved assets only. To use them later, render `<FeatureIcon name="hrm" />` or `<FeatureIcon name="salesCommission" />`; no unfinished application is exposed to users.

## DT Link

The dashboard starts without the bookmark panel. The DT Link shortcut sits immediately after DT Calendar. Opening it mounts the existing bookmark widget below the shortcuts, scrolls it into view and focuses its region. The navigation entry opens the same panel. Repeated clicks return to that panel without clearing its contents. Reduced-motion preferences disable smooth scrolling.

## Generation prompt

Create production icon assets from the supplied DT brand sheet, closely preserving its polished glossy 3D illustrations and pastel circular backplates. Output a square transparent PNG atlas in a perfectly regular 3 × 3 grid, with equal cells, consistent scale and centered artwork. Row 1: stacked cyan/violet/blue platform layers; cyan/blue asset folder with document and green chart; cyan/green/orange connected workflow nodes. Row 2: cyan/violet interlocking chain links; financial statement with dollar symbol and blue bars; orange notebook with blue pencil. Row 3: blue/white calendar on pink; blue people with teal gear; rising blue bars, orange arrow and gold dollar coin. No text, labels or underlines. Transparent gutters and outside the circular backplates. Keep the artwork inside its own cell.

The header retains the DTOne company logo. In the sidebar, Trang chủ uses the home icon, while the former Ứng dụng entry is named DT Platform and uses the platform artwork.
