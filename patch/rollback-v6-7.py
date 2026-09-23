from pathlib import Path

CSS = Path("artifacts/solana-multi-wallet/src/index.css")
START = "/* v6.7 SOFTWARE PALETTE BEGIN"
END = "/* v6.7 SOFTWARE PALETTE END */"

css = CSS.read_text()
start = css.find(START)
if start == -1:
    print("v6.7 palette block not found; nothing to roll back.")
    raise SystemExit(0)

end = css.find(END, start)
if end == -1:
    raise SystemExit("v6.7 end marker not found")

end += len(END)
while end < len(css) and css[end] in "\r\n":
    end += 1

CSS.write_text(css[:start].rstrip() + "\n")
print("v6.7 software palette removed; v6.6 colors restored.")
