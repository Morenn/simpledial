import os
import re
import sys

def sanitize(name):
    return re.sub(r'[^a-zA-Z0-9 _.-]', '_', name)

def extract_favicon(url):
    try:
        domain = url.split("/")[2]
        return f"https://www.google.com/s2/favicons?domain={domain}"
    except:
        return ""

def main():
    if len(sys.argv) < 3:
        print("Použitie: python firefox_to_url.py bookmarks.html vystup")
        return

    html_file = sys.argv[1]
    output_root = sys.argv[2]

    os.makedirs(output_root, exist_ok=True)

    stack = [output_root]  # zásobník priečinkov podľa hĺbky <DL>

    with open(html_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()

            # Začiatok priečinka (<DL>)
            if line.startswith("<DL"):
                # prehĺbime úroveň
                stack.append(stack[-1])
                continue

            # Koniec priečinka (</DL>)
            if line.startswith("</DL"):
                if len(stack) > 1:
                    stack.pop()
                continue

            # Priečinok (<H3>)
            if "<H3" in line:
                name = re.sub(r".*<H3[^>]*>(.*?)</H3>.*", r"\1", line)
                name = sanitize(name)
                folder_path = os.path.join(stack[-1], name)
                os.makedirs(folder_path, exist_ok=True)
                stack[-1] = folder_path
                continue

            # Bookmark (<A HREF="...">)
            if "<A " in line:
                url = re.sub(r'.*HREF="([^"]*)".*', r"\1", line)
                title = re.sub(r".*>(.*?)</A>.*", r"\1", line)
                title = sanitize(title)

                icon = extract_favicon(url)

                file_path = os.path.join(stack[-1], f"{title}.url")
                with open(file_path, "w", encoding="utf-8") as f_out:
                    f_out.write("[InternetShortcut]\n")
                    f_out.write(f"URL={url}\n")
                    f_out.write(f"IconFile={icon}\n")
                    f_out.write("IconIndex=0\n")

    print("Hotovo! Všetky priečinky a .url súbory boli vytvorené.")

if __name__ == "__main__":
    main()
