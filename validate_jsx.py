
import re

# Tags that are always self-closing in HTML / React-land and should never be
# pushed onto the open-tag stack.
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}


def strip_jsx_expressions(content: str) -> str:
    """
    Replace {...} JSX expression blocks with a same-length whitespace string so
    that `>` characters inside expressions don't fool the tag scanner.
    Handles nested braces correctly.
    """
    chars = list(content)
    depth = 0
    in_string_char = None

    for i, ch in enumerate(chars):
        if in_string_char:
            if ch == in_string_char and (i == 0 or chars[i - 1] != "\\"):
                in_string_char = None
            elif depth > 0:
                chars[i] = " "
            continue

        if ch in ('"', "'", "`") and depth > 0:
            in_string_char = ch
            continue

        if ch == "{":
            depth += 1
            if depth > 0:
                chars[i] = " "
            continue

        if ch == "}":
            if depth > 0:
                chars[i] = " "
                depth -= 1
            continue

        if depth > 0:
            chars[i] = " "

    return "".join(chars)


def strip_comments(content: str) -> str:
    """Remove JSX {/* ... */} comments and HTML <!-- --> comments."""
    content = re.sub(r"<!--[\s\S]*?-->", lambda m: " " * len(m.group()), content)
    return content


def validate_jsx(filename: str) -> None:
    with open(filename, "r", encoding="utf-8") as f:
        raw = f.read()

    # Work on a sanitised copy so JSX expressions don't confuse the regex.
    content = strip_comments(raw)
    content = strip_jsx_expressions(content)

    stack: list[tuple[str, int]] = []
    errors: list[str] = []

    def line_of(pos: int) -> int:
        return raw[:pos].count("\n") + 1

    # Match:  <>  |  </>  |  <TagName .../>  |  <TagName ...>  |  </TagName>
    TAG_RE = re.compile(
        r"<(?:"
        r"(/?)([A-Za-z][A-Za-z0-9.]*)(\s[^>]*)?(/>|>)"  # normal tags
        r"|(/?>)"                                           # <> or </>
        r")",
        re.DOTALL,
    )

    for m in TAG_RE.finditer(content):
        pos = m.start()
        ln = line_of(pos)

        if m.group(5) is not None:
            # Fragment: <> or </>
            frag = m.group(0)
            if frag == "<>":
                stack.append(("<>", ln))
            else:  # </>
                if not stack:
                    errors.append(f"Error: unexpected </> at line {ln}")
                else:
                    top_tag, top_ln = stack.pop()
                    if top_tag != "<>":
                        errors.append(
                            f"Warning: closed </> at line {ln} but expected </{top_tag}> (opened line {top_ln})"
                        )
        else:
            slash, tag_name, _attrs, end = m.group(1), m.group(2), m.group(3), m.group(4)
            tag_lower = tag_name.lower()

            if end == "/>":
                # Self-closing: <Tag ... />  — nothing to push
                continue

            if slash:
                # Closing tag: </Tag>
                if not stack:
                    errors.append(f"Error: unexpected </{tag_name}> at line {ln}")
                else:
                    top_tag, top_ln = stack.pop()
                    if top_tag.lower() != tag_lower:
                        errors.append(
                            f"Warning: </{tag_name}> at line {ln} but expected </{top_tag}> (opened line {top_ln})"
                        )
            else:
                # Opening tag: <Tag ...>
                if tag_lower not in VOID_TAGS:
                    stack.append((tag_name, ln))

    # Summary
    frag_opens = raw.count("<>")
    frag_closes = raw.count("</>")
    print(f"Fragments: {frag_opens} open, {frag_closes} close")

    if errors:
        print(f"\n{len(errors)} issue(s) found:")
        for e in errors:
            print(" ", e)
    else:
        print("✓ No structural issues detected.")

    if stack:
        print(f"\n{len(stack)} unclosed tag(s) remaining:")
        for tag, ln in stack:
            print(f"  <{tag}> opened at line {ln}")
    else:
        print("✓ All tags balanced.")


validate_jsx("src/pages/DataQualityQueue.tsx")
