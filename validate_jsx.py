
import re

def validate_jsx(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find tags: opening tags like <div>, closing tags like </div>, self-closing like <br/>
    # We focus on major ones: div, Sheet, SheetContent, SheetHeader, SheetTitle, Card, CardHeader, CardContent, details, summary, span, p, table, thead, tbody, tr, th, td, Button, Checkbox, Textarea, Label, StatusBadge, ClipboardCheck, AlertTriangle, CircleCheckBig, fragment <>, </>
    
    tags = re.findall(r'<(/?)([a-zA-Z]+[a-zA-Z0-9]*|)([^>]*?)>', content)
    # Fragment special case
    fragment_opens = re.findall(r'<>[^/]', content) # rough
    fragment_closes = re.findall(r'</>', content)
    
    stack = []
    line_counts = content.split('\n')
    
    # Simpler approach: balanced stack for all tags found
    for match in re.finditer(r'<(/?[a-zA-Z]+[a-zA-Z0-9]*|)(/?)([^>]*?)>', content):
        tag_full = match.group(0)
        tag_name = match.group(1)
        is_self_closing = match.group(2) == '/'
        
        if tag_full.startswith('<!--') or tag_full.startswith('<!DOCTYPE'):
            continue
            
        if not tag_name: # Fragment
            stack.append(('<>', content[:match.start()].count('\n') + 1))
            continue
            
        if tag_name.startswith('/'): # Closing tag
            tag_name = tag_name[1:]
            if not stack:
                print(f"Error: Unexpected closing tag </{tag_name}> at line {content[:match.start()].count('\n') + 1}")
                continue
            last_tag, last_line = stack.pop()
            if last_tag != tag_name and last_tag != '<>': # Rough check
                 # Handle fragment closure
                 if tag_name == '': # matches </>
                     print(f"Closed fragment at line {content[:match.start()].count('\n') + 1}")
                 else:
                     print(f"Warning: Closure mismatch. Found </{tag_name}> at line {content[:match.start()].count('\n') + 1}, expected closure for <{last_tag}> from line {last_line}")
        elif is_self_closing:
            pass # ignore
        else: # Opening tag
            stack.append((tag_name, content[:match.start()].count('\n') + 1))

    # Also check fragments explicitly
    opens = content.count('<>')
    closes = content.count('</>')
    print(f"Fragments: {opens} open, {closes} close")

    if stack:
        print("Unclosed tags remaining in stack:")
        for tag, line in stack:
            print(f"  <{tag}> from line {line}")

validate_jsx('src/pages/DataQualityQueue.tsx')
