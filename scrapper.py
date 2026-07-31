import os
import re
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

BASE_URL = "https://rbi.org.in/scripts/bs_viewcontent.aspx?Id=2009"

HEADERS = {
    "User-Agent": "Mozilla/5.0"
}

DOWNLOAD_DIR = "downloads"

os.makedirs(DOWNLOAD_DIR, exist_ok=True)

print("Opening RBI page...")

html = requests.get(BASE_URL, headers=HEADERS).text

soup = BeautifulSoup(html, "lxml")

links = soup.find_all("a")

excel_links = []

for a in links:
    href = a.get("href")
    if not href:
        continue

    if ".xls" in href.lower() or ".xlsx" in href.lower():
        excel_links.append(urljoin(BASE_URL, href))

print(f"Found {len(excel_links)} excel files")

for i, url in enumerate(excel_links, 1):

    filename = url.split("/")[-1].split("?")[0]

    filename = re.sub(r"[^\w\-.]", "_", filename)

    path = os.path.join(DOWNLOAD_DIR, filename)

    print(f"[{i}/{len(excel_links)}] Downloading {filename}")

    r = requests.get(url, headers=HEADERS)

    with open(path, "wb") as f:
        f.write(r.content)

print("\nDone.")
print(f"Files saved in: {DOWNLOAD_DIR}")