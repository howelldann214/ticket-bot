from paddleocr import PaddleOCR
import time

# 初始化（新版語法）
ocr = PaddleOCR(
    lang='en',
    use_textline_orientation=False,
    device='cpu'
)

img_path = "test.png"

# 開始計時
start = time.time()
result = ocr.predict(img_path)
elapsed = time.time() - start

# 顯示結果
if isinstance(result, list) and len(result) > 0 and isinstance(result[0], dict):
    texts = result[0].get("rec_texts", [])
    scores = result[0].get("rec_scores", [])
    for t, s in zip(texts, scores):
        print(f"text='{t}'  score={s:.3f}")
else:
    print("無法解析結果:", result)

print(f"\n辨識耗時：{elapsed:.3f} 秒")
