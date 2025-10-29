# ocr_server.py (修正版，適用 PaddleOCR 3.x pipeline)
import os
import time
import re
from paddleocr import PaddleOCR
import threading
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import socketserver

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ====== 可調參數 ======
# 對於 PaddlePaddle 3.x，官方警告 OMP 多執行緒在某些 BLAS 組合下可能反而拖慢或出錯。
# 先設成 1，確保穩定。之後你可以自己測把它改回 "8" 看延遲。
os.environ["OMP_NUM_THREADS"] = "4"
os.environ["MKL_NUM_THREADS"] = "4"

# 你的模型資料夾：
TEXT_DET_MODEL_DIR = os.path.join(BASE_DIR, "models", "det")
TEXT_REC_MODEL_DIR = os.path.join(BASE_DIR, "models", "rec")
USE_GPU = False  
print("[INFO] Initializing PaddleOCR... 這一步會花比較久，之後就不會了")

ocr = PaddleOCR(
    device="gpu" if USE_GPU else "cpu",

    # 指定我們想用比較輕的 mobile 模型，而不是預設 server 模型
    text_detection_model_name="PP-OCRv5_mobile_det",
    text_recognition_model_name="en_PP-OCRv4_mobile_rec",

    # 指定實際的本地路徑（資料夾內要有 inference.pdmodel / inference.pdiparams / inference.yaml）
    text_detection_model_dir=TEXT_DET_MODEL_DIR,
    text_recognition_model_dir=TEXT_REC_MODEL_DIR,

    # 關掉不必要的附加模組，降低延遲
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
)

print("[INFO] PaddleOCR 初始化完成")


def format_ocr_code(s: str) -> str:
    if s is None:
        return ""
    # 去除非英數字元（保留原本大小寫）
    cleaned = re.sub(r"[^A-Za-z0-9]", "", s)

    # 若長度 >= 4，回傳前 4 碼（保留大小寫）
    if len(cleaned) >= 4:
        return cleaned[:4]

    # 長度小於 4，回傳清理後的結果（呼叫者可視為不符合）
    return cleaned


# warm-up：用一張代表性的圖片 (可選)
WARMUP_IMAGE = "OCR/warmup.png"
if os.path.exists(WARMUP_IMAGE):
    print("[INFO] Warm-up with", WARMUP_IMAGE)
    _ = ocr.predict(WARMUP_IMAGE)
    print("[INFO] Warm-up done")
else:
    print("[WARN] 找不到 warmup.png，略過 warm-up")

print("READY. 請輸入圖片路徑 (exit 結束)")

# --- 簡單的本機 HTTP API，讓外部程式可以呼叫 OCR ---
PORT = 5001


class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True


class OCRRequestHandler(BaseHTTPRequestHandler):
    def _set_headers(self, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()

    def log_message(self, format, *args):
        # silence or route to print
        print("[HTTP] " + (format % args))

    def do_POST(self):
        # 只處理 /ocr
        if self.path != '/ocr':
            self._set_headers(404)
            self.wfile.write(json.dumps({'success': False, 'error': 'Not found'}).encode('utf-8'))
            return

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b''
        try:
            payload = json.loads(body.decode('utf-8')) if body else {}
        except Exception as e:
            self._set_headers(400)
            self.wfile.write(json.dumps({'success': False, 'error': 'Invalid JSON', 'detail': str(e)}).encode('utf-8'))
            return

        img_path = payload.get('path', 'screenshots/captcha.png')
        if not os.path.isabs(img_path):
            img_path = os.path.join(os.getcwd(), img_path)

        if not os.path.exists(img_path):
            self._set_headers(404)
            self.wfile.write(json.dumps({'success': False, 'error': f'File not found: {img_path}'}).encode('utf-8'))
            return

        start = time.time()
        try:
            result = ocr.predict(img_path)
        except Exception as e:
            self._set_headers(500)
            self.wfile.write(json.dumps({'success': False, 'error': 'OCR failed', 'detail': str(e)}).encode('utf-8'))
            return
        elapsed = time.time() - start

        items = []
        if isinstance(result, list) and len(result) > 0 and isinstance(result[0], dict):
            texts = result[0].get('rec_texts', [])
            scores = result[0].get('rec_scores', [])
            for t, s in zip(texts, scores):
                fmt = format_ocr_code(t)
                is_valid = bool(re.fullmatch(r"[A-Za-z0-9]{4}", fmt))
                items.append({
                    'formatted': fmt,
                    'raw': t,
                    'score': float(s),
                    'is_valid': is_valid,
                })
        else:
            items.append({'raw_result': str(result)})

        resp = {
            'success': True,
            'elapsed': elapsed,
            'items': items,
        }
        self._set_headers(200)
        self.wfile.write(json.dumps(resp, ensure_ascii=False).encode('utf-8'))


def start_http_server(port=PORT):
    server = ThreadingHTTPServer(('127.0.0.1', port), OCRRequestHandler)
    print(f"[INFO] OCR HTTP server listening on http://127.0.0.1:{port}/ocr")
    server.serve_forever()


# 啟動 HTTP server 在背景 thread
http_thread = threading.Thread(target=start_http_server, daemon=True)
http_thread.start()

while True:
    try:
        img_path = input("> ").strip()
    except EOFError:
        break

    if img_path.lower() in ["exit", "quit", "q"]:
        print("[INFO] 結束")
        break

    if not os.path.exists(img_path):
        print(f"[ERROR] 找不到檔案: {img_path}")
        continue

    start = time.time()
    result = ocr.predict(img_path)
    elapsed = time.time() - start

    # 解析 pipeline 輸出 (跟你一開始 test.py 那版一樣)
    if isinstance(result, list) and len(result) > 0 and isinstance(result[0], dict):
        texts = result[0].get("rec_texts", [])
        scores = result[0].get("rec_scores", [])
        if len(texts) == 0:
            print("[RESULT] (無文字)")
        else:
            for t, s in zip(texts, scores):
                fmt = format_ocr_code(t)
                # 驗證：任意 4 碼英數皆視為合格（大小寫保留）
                is_valid = bool(re.fullmatch(r"[A-Za-z0-9]{4}", fmt))
                if is_valid:
                    print(f"[RESULT] formatted='{fmt}'  raw='{t}'  score={s:.3f}  (符合 4 碼英數)")
                else:
                    print(f"[RESULT] raw='{t}'  formatted_candidate='{fmt}'  score={s:.3f}  (不符合 4 碼英數)")
    else:
        print("[RESULT] 無法解析結果:", result)

    print(f"[TIME] 推理耗時：{elapsed:.3f} 秒")
