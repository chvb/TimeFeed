#!/usr/bin/env python3
"""
Auto-Changelog-Generator für TimeFeed (Markdown-basiert).

Erzeugt neue Einträge in CHANGELOG.md aus den Git-Commits, hebt die Version
an und synchronisiert VERSION + package.json (root/client/server).

Wird aufgerufen von:
  - scripts/update-changelog.sh   (lokal, z.B. via Cron)
  - .github/workflows/changelog.yml (GitHub Action bei Push auf master)

Versions-Sprung über Commit-Prefixe:
  [major] → X+1.0.0   [minor] → X.Y+1.0   (sonst) → X.Y.Z+1 (Patch)

Same-Day-Regel: Existiert die oberste Version bereits mit dem heutigen Datum,
werden neue Einträge dort einsortiert statt eine neue Version anzulegen.
"""
import os
import re
import sys
import json
import subprocess
from datetime import date

REPO = os.environ.get("REPO_DIR", os.getcwd())
CHANGELOG = os.path.join(REPO, "CHANGELOG.md")
VERSION_FILE = os.path.join(REPO, "VERSION")
MARKER_FILE = os.path.join(REPO, ".changelog-last-hash")
PKG_FILES = ["package.json", "client/package.json", "server/package.json"]

# Reihenfolge + Mapping der Kategorien
CAT_ORDER = ["Added", "Fixed", "Improved", "Security"]
CLASSIFY_MAP = {
    "feature": "Added",
    "bugfix": "Fixed",
    "improvement": "Improved",
    "security": "Security",
}

SENSITIVE = re.compile(r"password|passwort|secret|credential|token|admin@|\.env|api.?key", re.IGNORECASE)
SKIP = re.compile(r"^(Merge |Co-Authored|Revert|Initial|Erstinitialisierung|chore\b|Changelog v\d|changelog.*aktualisiert)", re.IGNORECASE)


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, cwd=REPO).stdout.strip()


def read(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


def version_key(v):
    return tuple(int(x) for x in v.split("."))


def classify(subject):
    s = subject.lower()
    if any(w in s for w in ["security", "sicherheit", "cve", "vulnerab"]):
        return "security"
    if any(w in s for w in ["fix", "bugfix", "hotfix", "behoben", "korrigiert", "repariert", "fehler", "bug"]):
        return "bugfix"
    if any(w in s for w in ["add", "implement", "create", "new", "feature", "hinzugefügt", "hinzugefugt", "neu", "erstellt", "eingerichtet", "feat"]):
        return "feature"
    return "improvement"


def clean_subject(s):
    s = re.sub(r"\[(?:major|minor)\]\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*Co-Authored-By:.*$", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^(feat|fix|chore|docs|refactor|style|test|perf)(\([^)]*\))?:\s*", "", s, flags=re.IGNORECASE)
    return s.strip().rstrip(".")


def determine_range():
    """Liefert die git-log-Argumente für den zu verarbeitenden Commit-Bereich."""
    # 1) Letzten Bot-Commit suchen (funktioniert auch im frischen CI-Checkout)
    log = git("log", "--format=%H|%s", "-200")
    last_bot = None
    for line in log.splitlines():
        h, _, subj = line.partition("|")
        if "[changelog-bot]" in subj:
            last_bot = h
            break
    if last_bot:
        return [f"{last_bot}..HEAD"]
    # 2) Marker-Datei (lokaler Lauf)
    marker = read(MARKER_FILE).strip()
    if marker and subprocess.run(["git", "cat-file", "-t", marker], capture_output=True, cwd=REPO).returncode == 0:
        return [f"{marker}..HEAD"]
    # 3) Fallback: letzte 20 Commits
    return ["-20"]


def collect_commits(existing_texts):
    rng = determine_range()
    out = git("log", *rng, "--format=%h|%s", "--no-merges")
    commits, seen = [], set()
    for line in out.splitlines():
        if not line or "[changelog-bot]" in line:
            continue
        h, _, subject = line.partition("|")
        subject = subject.strip()
        if not subject or SENSITIVE.search(subject) or SKIP.match(subject):
            continue
        cleaned = clean_subject(subject)
        if not cleaned or cleaned in seen or cleaned in existing_texts:
            continue
        seen.add(cleaned)
        commits.append((subject, cleaned))
    return commits


def existing_bullets(content):
    return set(m.group(1).strip() for m in re.finditer(r"^- (.+)$", content, re.MULTILINE))


def parse_top_section(content):
    """Zerlegt das oberste ## [ver] - date Block in (version, date, buckets, span)."""
    m = re.search(r"^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*\n(.*?)(?=\n## \[|\Z)", content, re.DOTALL | re.MULTILINE)
    if not m:
        return None
    version, ver_date, body = m.group(1), m.group(2), m.group(3)
    buckets = {}
    cur = None
    for line in body.splitlines():
        hm = re.match(r"^### (\w+)", line)
        if hm:
            cur = hm.group(1)
            buckets.setdefault(cur, [])
            continue
        bm = re.match(r"^- (.+)$", line)
        if bm and cur:
            buckets[cur].append(bm.group(1).strip())
    return {"version": version, "date": ver_date, "buckets": buckets, "span": m.span()}


def render_section(version, ver_date, buckets):
    lines = [f"## [{version}] - {ver_date}", ""]
    for cat in CAT_ORDER:
        items = buckets.get(cat)
        if not items:
            continue
        lines.append(f"### {cat}")
        for it in items:
            lines.append(f"- {it}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def write_pkg_versions(new_version):
    for rel in PKG_FILES:
        path = os.path.join(REPO, rel)
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (ValueError, OSError):
            continue
        if data.get("version") != new_version:
            data["version"] = new_version
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write("\n")
            print(f"  package: {rel} → {new_version}")


def main():
    content = read(CHANGELOG)
    if not content:
        print("CHANGELOG.md nicht gefunden — Abbruch")
        return 0

    head = git("rev-parse", "HEAD")
    commits = collect_commits(existing_bullets(content))
    if not commits:
        with open(MARKER_FILE, "w") as f:
            f.write(head)
        print("Keine neuen relevanten Commits")
        return 0

    # Kategorien füllen (neueste zuerst)
    new_buckets = {}
    bump = "patch"
    for subject, cleaned in commits:
        low = subject.lower()
        if "[major]" in low:
            bump = "major"
        elif "[minor]" in low and bump != "major":
            bump = "minor"
        cat = CLASSIFY_MAP[classify(subject)]
        new_buckets.setdefault(cat, []).append(cleaned)

    today = date.today().isoformat()
    versions = re.findall(r"## \[(\d+\.\d+\.\d+)\]", content)
    latest = max(versions, key=version_key) if versions else "1.0.0"

    top = parse_top_section(content)
    if top and top["date"] == today:
        # Same-Day: in bestehende oberste Version einsortieren
        version = top["version"]
        merged = top["buckets"]
        for cat in CAT_ORDER:
            for it in new_buckets.get(cat, []):
                merged.setdefault(cat, [])
                if it not in merged[cat]:
                    merged[cat].append(it)
        new_block = render_section(version, today, merged)
        s, e = top["span"]
        content = content[:s] + new_block + content[e:]
        print(f"Changelog v{version}: {len(commits)} Einträge ergänzt (Same-Day)")
    else:
        # Neue Version anlegen
        parts = list(version_key(latest))
        if bump == "major":
            parts = [parts[0] + 1, 0, 0]
        elif bump == "minor":
            parts = [parts[0], parts[1] + 1, 0]
        else:
            parts = [parts[0], parts[1], parts[2] + 1]
        version = ".".join(str(x) for x in parts)
        new_block = render_section(version, today, new_buckets)
        # Vor der ersten bestehenden Version einfügen
        m = re.search(r"^## \[", content, re.MULTILINE)
        if m:
            content = content[:m.start()] + new_block + "\n" + content[m.start():]
        else:
            content = content.rstrip() + "\n\n" + new_block
        print(f"Changelog v{version}: neue Version mit {len(commits)} Einträgen ({bump})")

    with open(CHANGELOG, "w", encoding="utf-8") as f:
        f.write(content)
    with open(VERSION_FILE, "w") as f:
        f.write(version + "\n")
    write_pkg_versions(version)
    with open(MARKER_FILE, "w") as f:
        f.write(head)
    return 0


if __name__ == "__main__":
    sys.exit(main())
