#!/usr/bin/env python3
"""本地优选后，把 IP/域名远程 POST 到 warp-masque Worker。

用法:
  python3 push_endpoints.py https://xxx.workers.dev/push/<token> result.csv
  python3 push_endpoints.py https://xxx.workers.dev/push/<token> ips.txt --mode prefer
  echo "162.159.198.1:443" | python3 push_endpoints.py https://xxx.workers.dev/push/<token> -

文件格式（任选）:
  - 一行一个 host 或 host:port
  - CSV：若有 endpoint/ip/host 列会自动识别，否则取第一列
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.request


def load_lines(path: str) -> list[str]:
    if path == "-":
        text = sys.stdin.read()
    else:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()

    lines = []
    # CSV?
    if path != "-" and path.lower().endswith(".csv"):
        import io
        reader = csv.DictReader(io.StringIO(text))
        if reader.fieldnames:
            keys = [k.lower() for k in reader.fieldnames]
            pick = None
            for cand in ("endpoint", "ip", "host", "server", "address"):
                if cand in keys:
                    pick = reader.fieldnames[keys.index(cand)]
                    break
            port_key = None
            if "port" in keys:
                port_key = reader.fieldnames[keys.index("port")]
            if pick:
                for row in reader:
                    host = (row.get(pick) or "").strip()
                    if not host:
                        continue
                    port = (row.get(port_key) or "").strip() if port_key else ""
                    lines.append(f"{host}:{port}" if port else host)
                return lines
        # fallback first column
        reader = csv.reader(io.StringIO(text))
        for row in reader:
            if not row:
                continue
            if row[0].lower() in ("ip", "host", "endpoint", "address"):
                continue
            lines.append(row[0].strip())
        return [x for x in lines if x]

    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        if "#" in s:
            s = s.split("#", 1)[0].strip()
        # CSV-ish line
        if "," in s:
            s = s.split(",", 1)[0].strip()
        if s:
            lines.append(s)
    return lines


def main() -> None:
    ap = argparse.ArgumentParser(description="POST 优选接入点到 Worker")
    ap.add_argument("push_url", help="管理页复制的推送地址，不要带 /endpoints")
    ap.add_argument("file", help="优选结果文件，- 表示 stdin")
    ap.add_argument("--mode", choices=("merge", "prefer", "only"), default="prefer")
    ap.add_argument("--append", action="store_true", help="追加而不是覆盖")
    args = ap.parse_args()

    items = load_lines(args.file)
    if not items:
        print("没有解析到任何 endpoint", file=sys.stderr)
        sys.exit(1)

    base = args.push_url.rstrip("/")
    if not base.endswith("/endpoints"):
        url = base + "/endpoints"
    else:
        url = base

    body = {
        "endpoints": items,
        "mode": args.mode,
        "replace": not args.append,
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    print(f"POST {url}  ({len(items)} 条, mode={args.mode})")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp_body = resp.read().decode("utf-8", errors="replace")
            print(resp.status, resp_body)
    except Exception as e:
        print(f"失败: {e}", file=sys.stderr)
        if hasattr(e, "read"):
            try:
                print(e.read().decode(), file=sys.stderr)
            except Exception:
                pass
        sys.exit(1)


if __name__ == "__main__":
    main()
