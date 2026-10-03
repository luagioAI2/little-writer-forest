# -*- coding: utf-8 -*-
"""下载所有42道题的Pexels照片，并验证可解码。"""
import os
import json
import time
import urllib.request
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DL_DIR = os.path.join(SCRIPT_DIR, 'img-exam')
os.makedirs(DL_DIR, exist_ok=True)

def pexels_url(pid):
    return f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?auto=compress&cs=tinysrgb&w=640"

def download(pid):
    path = os.path.join(DL_DIR, f"{pid}.jpg")
    if os.path.exists(path):
        try:
            im = Image.open(path)
            im.verify()
            return True, path, "cached"
        except:
            pass  # re-download if corrupted
    try:
        req = urllib.request.Request(pexels_url(pid), headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        with open(path, 'wb') as f:
            f.write(data)
        # verify
        im = Image.open(path)
        im.verify()
        return True, path, "ok"
    except Exception as e:
        return False, str(e), "error"

# load assignments
assignments = json.load(open(os.path.join(SCRIPT_DIR, 'photo-assignments.json')))

all_pids = set()
for tag, items in assignments.items():
    if tag.startswith('_'):
        continue
    for title, pid in items.items():
        all_pids.add(pid)

print(f"需要下载 {len(all_pids)} 张唯一照片")
success = 0
failed = []
for pid in sorted(all_pids):
    ok, info, status = download(pid)
    if ok:
        size = os.path.getsize(info) // 1024
        print(f"  ✓ {pid} ({size} KB) [{status}]")
        success += 1
    else:
        print(f"  ✗ {pid}: {info}")
        failed.append(pid)
    time.sleep(0.4)

print(f"\n成功: {success}/{len(all_pids)}")
if failed:
    print(f"失败: {failed}")
