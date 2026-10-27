"""Prepare the small UI seed catalog and its corresponding real movie posters.

This is a finite, explicit seed import, not a global movie crawler.
"""
from __future__ import annotations

import concurrent.futures
import io
import json
from pathlib import Path
import urllib.parse
import urllib.request
import urllib.error
import time

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SEEDS = [
    ("grand-budapest", "The_Grand_Budapest_Hotel", "布达佩斯大饭店", "The Grand Budapest Hotel", "韦斯·安德森", "美国 / 德国", "英语", ["grand-budapest", "amelie", "walter-mitty"]),
    ("in-the-mood", "In_the_Mood_for_Love", "花样年华", "In the Mood for Love", "王家卫", "中国香港 / 法国", "粤语 / 上海话", []),
    ("flipped", "Flipped_(2010_film)", "怦然心动", "Flipped", "罗伯·莱纳", "美国", "英语", []),
    ("walter-mitty", "The_Secret_Life_of_Walter_Mitty_(2013_film)", "白日梦想家", "The Secret Life of Walter Mitty", "本·斯蒂勒", "美国", "英语", []),
    ("interstellar", "Interstellar_(film)", "星际穿越", "Interstellar", "克里斯托弗·诺兰", "美国 / 英国", "英语", []),
    ("totoro", "My_Neighbor_Totoro", "龙猫", "となりのトトロ", "宫崎骏", "日本", "日语", []),
    ("truman", "The_Truman_Show", "楚门的世界", "The Truman Show", "彼得·威尔", "美国", "英语", []),
    ("coco", "Coco_(2017_film)", "寻梦环游记", "Coco", "李·昂克里奇 / 阿德里安·莫利纳", "美国", "英语", []),
    ("intouchables", "The_Intouchables", "触不可及", "Intouchables", "奥利维埃·纳卡什 / 埃里克·托莱达诺", "法国", "法语", []),
    ("amelie", "Amélie", "天使爱美丽", "Le Fabuleux Destin d’Amélie Poulain", "让-皮埃尔·热内", "法国 / 德国", "法语", []),
    ("soul", "Soul_(2020_film)", "心灵奇旅", "Soul", "彼特·道格特 / 凯普·鲍尔斯", "美国", "英语", []),
    ("zootopia", "Zootopia", "疯狂动物城", "Zootopia", "拜伦·霍华德 / 瑞奇·摩尔", "美国", "英语", []),
    ("groundhog", "Groundhog_Day_(film)", "土拨鼠之日", "Groundhog Day", "哈罗德·雷米斯", "美国", "英语", []),
    ("our-little-sister", "Our_Little_Sister", "海街日记", "海街diary", "是枝裕和", "日本", "日语", []),
    ("inception", "Inception", "盗梦空间", "Inception", "克里斯托弗·诺兰", "美国 / 英国", "英语", []),
    ("12-angry-men", "12_Angry_Men_(1957_film)", "十二怒汉", "12 Angry Men", "西德尼·吕美特", "美国", "英语", []),
    ("roman-holiday", "Roman_Holiday", "罗马假日", "Roman Holiday", "威廉·惠勒", "美国", "英语 / 意大利语", []),
    ("chungking-express", "Chungking_Express", "重庆森林", "Chungking Express", "王家卫", "中国香港", "粤语 / 普通话", []),
    ("bullets-fly", "Let_the_Bullets_Fly", "让子弹飞", "Let the Bullets Fly", "姜文", "中国大陆 / 中国香港", "普通话", []),
    ("eat-drink", "Eat_Drink_Man_Woman", "饮食男女", "Eat Drink Man Woman", "李安", "中国台湾 / 美国", "普通话", []),
    ("to-live", "To_Live_(1994_film)", "活着", "To Live", "张艺谋", "中国大陆 / 中国香港", "普通话", []),
    ("dying-to-survive", "Dying_to_Survive", "我不是药神", "Dying to Survive", "文牧野", "中国大陆", "普通话", []),
]


def request_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "LightmoonMoviePrototype/0.1 (finite UI seed catalog)"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 2:
                raise
            retry = error.headers.get("Retry-After", "8")
            delay = int(retry) if retry.isdigit() else 10
            if delay > 60:
                raise RuntimeError("Source requested a longer pause; retry the seed import later.") from error
            time.sleep(max(8, delay))
    raise RuntimeError("Source did not return an image")


def prepare(seed: tuple, base: dict) -> dict:
    movie_id, article, title, original_title, director, country, language, _ = seed
    summary_url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(article, safe="_()")
    cache = ROOT / "scripts" / ".cache" / (movie_id + ".json")
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.is_file():
        summary = json.loads(cache.read_text(encoding="utf-8"))
    else:
        summary = json.loads(request_bytes(summary_url))
        cache.write_text(json.dumps(summary, ensure_ascii=False), encoding="utf-8")
    source_image = summary.get("originalimage") or summary.get("thumbnail")
    if not source_image:
        raise RuntimeError(f"Missing movie poster for {title}")
    image_url = source_image["source"].split("?", 1)[0]
    if urllib.parse.urlsplit(image_url).hostname != "upload.wikimedia.org":
        raise RuntimeError(f"Unexpected image host for {title}")
    destination = ROOT / "public" / "posters" / (movie_id + ".webp")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file():
        image = Image.open(destination)
    else:
        image = Image.open(io.BytesIO(request_bytes(image_url))).convert("RGB")
        if image.width >= image.height:
            raise RuntimeError(f"Expected a portrait movie poster for {title}")
        image.save(destination, "WEBP", quality=89)
        time.sleep(1)
    if image.width > 600 or image.height > 900:
        image.thumbnail((600, 900))
        image.save(destination, "WEBP", quality=88)
    movie = {
        **base[title],
        "id": movie_id,
        "originalTitle": original_title,
        "director": director,
        "country": country,
        "language": language,
        "poster": "/posters/" + destination.name,
        "posterWidth": image.width,
        "posterHeight": image.height,
        "source": {
            "page": summary.get("content_urls", {}).get("desktop", {}).get("page", "https://en.wikipedia.org/wiki/" + urllib.parse.quote(article)),
            "poster": image_url,
            "summaryTitle": summary.get("title"),
        },
        "tagStatus": "editorial-demo",
    }
    print(f"Prepared {movie_id}: {image.width}x{image.height}", flush=True)
    return movie


def main() -> None:
    base_file = ROOT / "scripts" / "seed-base.json"
    base = {movie["title"]: movie for movie in json.loads(base_file.read_text(encoding="utf-8"))}
    chinese_file = ROOT / "scripts" / "chinese-seeds.json"
    base.update({movie["title"]: movie for movie in json.loads(chinese_file.read_text(encoding="utf-8"))})
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        movies = list(pool.map(lambda seed: prepare(seed, base), SEEDS))
    target = ROOT / "src" / "data" / "movies.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(movies, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(movies)} movie records and real posters.", flush=True)


if __name__ == "__main__":
    main()
