#!/usr/bin/env python3
"""Copy the public GIB league sheets into data/ as CSV.

Runs in GitHub Actions on a schedule. A file is only replaced when the download
looks right (expected header, enough rows), so a sheet outage or a sharing
change never wipes the copy the site is using.
"""
import csv, io, json, os, sys, time, urllib.parse, urllib.request

S1 = "1J_qf7qsNLp8JFkl4x9eYadl5m1GBzZKUSS3TuanKwBA"   # Season 1 league sheet
S2 = "1eH3lgNQ-sXnuUV1QtRk26dRjp5ltXFNBeiScDYH__QU"   # Season 2 league sheet (current)
PA_GID = "692400938"                                    # "PA Log" tab in both sheets

def export(sheet, gid):
    return f"https://docs.google.com/spreadsheets/d/{sheet}/export?format=csv&gid={gid}"

def tab(sheet, name):
    q = urllib.parse.urlencode({"tqx": "out:csv", "headers": "1", "sheet": name})
    return f"https://docs.google.com/spreadsheets/d/{sheet}/gviz/tq?{q}"

PA_HEAD = ["Hitter", "Hitter ID", "Swing", "Pitcher", "Pitcher ID", "Pitch"]
# (file, url, header the first row must start with, minimum data rows)
TARGETS = [
    ("s1_pa.csv", export(S1, PA_GID), PA_HEAD, 100),
    ("s2_pa.csv", export(S2, PA_GID), PA_HEAD, 100),
    ("s2_players.csv", tab(S2, "Players (DO NOT EDIT)"), ["Player ID", "Name", "Team"], 20),
    ("s2_parks.csv", tab(S2, "Parks and Teams (EDIT)"), ["Park Name", "Team Name", "Team"], 2),
]
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "gib-pitch-trends data refresh"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8-sig")
        except Exception as e:  # retry transient failures
            err = e
            time.sleep(5 * (attempt + 1))
    raise err

def main():
    os.makedirs(DATA, exist_ok=True)
    changed, failed = [], []
    for name, url, head, min_rows in TARGETS:
        try:
            text = get(url).replace("\r\n", "\n")
            rows = list(csv.reader(io.StringIO(text)))
            got = [c.strip() for c in rows[0][:len(head)]] if rows else []
            n = sum(1 for r in rows[1:] if any(c.strip() for c in r))
            if got != head:
                raise ValueError(f"unexpected header {got!r}")
            if n < min_rows:
                raise ValueError(f"only {n} rows (expected at least {min_rows})")
        except Exception as e:
            failed.append(f"{name}: {e}")
            continue
        path = os.path.join(DATA, name)
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if text != old:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(text)
            changed.append(name)
        print(f"{name}: {n} rows{' (updated)' if text != old else ''}")
    if changed:
        with open(os.path.join(DATA, "meta.json"), "w") as f:
            json.dump({"updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "changed": changed}, f)
    for msg in failed:
        print("FAILED " + msg, file=sys.stderr)
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
