import docx
import subprocess

def extract_text(file_path):
    ext = file_path.lower().split('.')[-1]
    if ext == 'txt':
        return extract_txt(file_path)
    elif ext == 'docx':
        return extract_docx(file_path)
    elif ext == 'doc':
        return extract_doc(file_path)
    else:
        return ""

def extract_txt(file_path):
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        return f.read()

def extract_docx(file_path):
    doc = docx.Document(file_path)
    return '\n'.join([p.text for p in doc.paragraphs])

def extract_doc(file_path):
    try:
        result = subprocess.run(['antiword', file_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return result.stdout
    except Exception as e:
        return f"[Error reading DOC file: {e}]"
