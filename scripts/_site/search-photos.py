# -*- coding: utf-8 -*-
"""为新增题目搜索 Pexels 照片候选。
输出：每个题目的推荐照片编号列表（供人工挑选）。"""
import json
import io

# 题目 → 搜索关键词映射（按标签分组）
KEYWORDS = {
    "growth": {
        "那一刻，我长大了": "child growing up milestone",
        "在挫折中成长": "child resilience determination",
        "我战胜了自己": "child success achievement",
        "独自面对": "child independent alone",
        "从错误中学会": "child learning mistake",
        "坚持就是胜利": "child persistence effort",
        "我的蜕变": "butterfly transformation child",
        "学会承担": "child responsibility helping",
        "风雨之后": "rainbow after rain child",
        "给自己点赞": "child proud thumbs up",
    },
    "reading": {
        "书中那句话": "child reading book quote",
        "我和书中的人物": "child imagination book character",
        "读完这本书": "child finishing book happy",
        "书里的世界": "child reading fantasy world",
        "一句话的启发": "child inspired quote",
        "如果我是主人公": "child hero costume dream",
        "我的读书故事": "child reading corner cozy",
        "推荐一本书": "child showing book friend",
    },
    "tradition": {
        "家乡的节日": "chinese festival celebration family",
        "老手艺人": "chinese craftsman traditional",
        "年味": "chinese new year family dinner",
        "非遗在身边": "chinese intangible heritage",
        "老物件的故事": "vintage antique family heirloom",
        "舌尖上的家乡": "chinese traditional food family",
        "庙会记忆": "chinese temple fair lantern",
        "传统与现代": "traditional modern contrast china",
    },
    "society": {
        "身边的变化": "city change before after",
        "环保小卫士": "child environmental protection",
        "科技改变生活": "technology life smartphone family",
        "陌生人的善意": "stranger kindness helping child",
        "我看网红现象": "social media influencer teen",
        "老小区的春天": "old community renovation china",
        "一次志愿服务": "volunteer service child helping",
        "网络与生活": "internet life balance family",
    },
    "gratitude": {
        "想对您说声谢谢": "child saying thank you",
        "致敬平凡英雄": "ordinary hero cleaner worker",
        "那双手": "hands working mother",
        "背影": "father walking away silhouette",
        "温暖的目光": "warm eyes looking child",
        "礼物": "child receiving gift happy",
        "一碗面的温度": "noodle soup family warm",
        "师恩难忘": "teacher student classroom gratitude",
    },
}

def pexels_cdn(pid):
    return f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?auto=compress&cs=tinysrgb&w=640"

# 这里先输出搜索关键词列表，供后续用 WebSearch 搜索
print("=" * 60)
print("新增42道题的Pexels搜索关键词")
print("=" * 60)
for tag, items in KEYWORDS.items():
    print(f"\n【{tag}】")
    for title, kw in items.items():
        print(f"  {title}: {kw}")
