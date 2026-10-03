# -*- coding: utf-8 -*-
"""批量搜索 Pexels 照片并下载验证，为42道新增题配图。
策略：按主题分组搜索，每个主题找3-5张通用图，然后分配给该主题下的题目。"""
import os
import sys
import json
import time
import urllib.request
import urllib.error

# 创建下载目录
DL_DIR = 'scripts/_site/img-exam'
os.makedirs(DL_DIR, exist_ok=True)

# 主题 → 搜索词 → 已知的Pexels照片ID列表（从之前的搜索中收集）
# 这里先用我已收集的ID，不足的再搜索
PHOTO_POOL = {
    "reading": [
        3457273, 3934082, 3661467, 6437813, 29249336, 8301243,
        8342284, 8923561, 8342279, 1741230, 8922368, 6437458,
        7494552, 7105618, 3626690, 5430500, 8923544, 8922322,
        7929352, 6692845, 6186124, 17428587, 8500671, 261889,
        20510962, 3654897, 30312945, 5896464, 10638235, 261895,
        3582865, 5905877, 3171067, 5896465, 23224850, 5063008,
        9873946, 9127062, 3768122, 36005723
    ],
    "growth": [
        # 需要搜索：孩子成长、挫折、坚持、独立
        278984, 1181715, 207697,  # placeholder
    ],
    "tradition": [
        # 需要搜索：中国传统、节日、手工艺、美食
        5871742,  # placeholder
    ],
    "society": [
        # 需要搜索：环保、科技、城市变化、志愿活动
        5871742,  # placeholder
    ],
    "gratitude": [
        # 需要搜索：感恩、老师、父母、礼物
        5871742,  # placeholder
    ],
}

def download(pid, outdir):
    """下载单张Pexels照片，返回是否成功"""
    url = f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?auto=compress&cs=tinysrgb&w=640"
    path = os.path.join(outdir, f"{pid}.jpg")
    if os.path.exists(path):
        return True, path
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
            with open(path, 'wb') as f:
                f.write(data)
        return True, path
    except Exception as e:
        return False, str(e)

# 先下载 reading 主题的照片（已收集到ID）
print("=" * 60)
print("下载 reading 主题照片")
print("=" * 60)
success = 0
for pid in PHOTO_POOL["reading"]:
    ok, info = download(pid, DL_DIR)
    if ok:
        size = os.path.getsize(info)
        print(f"  ✓ {pid} ({size//1024} KB)")
        success += 1
    else:
        print(f"  ✗ {pid}: {info}")
    time.sleep(0.3)

print(f"\nreading: {success}/{len(PHOTO_POOL['reading'])} 成功")

# 对于其他主题，我需要先搜索获取ID
# 由于搜索需要WebSearch工具，这里先输出需要搜索的关键词
print("\n" + "=" * 60)
print("其他主题需要搜索的关键词")
print("=" * 60)
OTHER_KEYWORDS = {
    "growth": ["child success achievement", "child resilience", "child independent", "rainbow after rain", "child proud"],
    "tradition": ["chinese new year family", "chinese craftsman", "chinese traditional food", "chinese temple fair", "vintage antique"],
    "society": ["child environmental protection", "technology family smartphone", "stranger helping child", "volunteer child helping", "city renovation"],
    "gratitude": ["child saying thank you", "teacher student classroom", "mother child warm", "father child walking", "child receiving gift"],
}
for theme, kws in OTHER_KEYWORDS.items():
    print(f"\n【{theme}】")
    for kw in kws:
        print(f"  {kw}")
