import os
import sys
import json
import re

def sanitize(name):
    # ponechá diakritiku, odstráni len nebezpečné znaky
    return re.sub(r'[<>:"/\\|?*]', '_', name)

def extract_favicon(item):
    # Firefox JSON môže obsahovať iconuri
    if "iconuri" in item:
        return item["iconuri"]

    # fallback favicon podľa domény
    try:
        domain = item["uri"].split("/")[2]
        return f"https://www.google.com/s2/favicons?domain={domain}"
    except:
        return ""

def process_node(node, current_path):
    node_type = node.get("type")

    # Priečinok
    if node_type == "text/x-moz-place-container":
        title = node.get("title", "Unnamed Folder")
        title = sanitize(title)

        folder_path = os.path.join(current_path, title)
        os.makedirs(folder_path, exist_ok=True)

        for child in node.get("children", []):
            process_node(child, folder_path)

    # Bookmark
    elif node_type == "text/x-moz-place":
        title = sanitize(node.get("title", "Untitled"))
        url = node.get("uri", "")
        icon = extract_favicon(node)

        file_path = os.path.join(current_path, f"{title}.url")

        with open(file_path, "w", encoding="utf-8") as f:
            f.write("[InternetShortcut]\n")
            f.write(f"URL={url}\n")
            f.write(f"IconFile={icon}\n")
            f.write("IconIndex=0\n")

    # Separator – ignorujeme
    elif node_type == "text/x-moz-place-separator":
        return


def main():
    if len(sys.argv) < 3:
        print("Použitie: python firefox_json_to_url_files.py bookmarks.json vystupny_priecinok")
        return

    json_file = sys.argv[1]
    output_folder = sys.argv[2]

    with open(json_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    os.makedirs(output_folder, exist_ok=True)

    # Firefox JSON má root → children → ďalšie root priečinky
    for root in data.get("children", []):
        process_node(root, output_folder)

    print("Hotovo! Všetky priečinky a .url súbory boli vytvorené.")


if __name__ == "__main__":
    main()
