import { chromium, Page } from 'playwright';
import readline from 'readline';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import sharp from "sharp";

dotenv.config();

// 計時用：按 Enter 後開始計時，填入 captcha 時停止
let enterStartTime: number | null = null;

// 🔧 用來讓你按 Enter 繼續流程
function waitForEnter(message: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

// 讀取終端輸入並回傳文字（用於輸入驗證碼）
function waitForInput(message: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

(async () => {
  // 連線到已經登入的 Brave 瀏覽器
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find(p => p.url().includes('club.adm.ncu.edu.tw')) || pages[0];

  console.log('[✓] 已連線到 Brave，當前網址：', page.url());

  // ✅ 等待到指定時間開始搶票流程
  await waitForEnter('[Enter] 登入完成並進入票頁後，按 Enter 執行搶票...\n');
  // 使用者按下 Enter 後開始計時
  enterStartTime = Date.now();
  console.log('[⏱] 已按 Enter，開始計時');
  console.log('[🔄] 刷新頁面...');
  await page.reload({ waitUntil: 'domcontentloaded' });
  console.log('[✅] 頁面刷新完成');

  // 確認場地選擇：志道樓 - 一樓大活動室 (value="1")
  try {
    const placeSelect = await page.locator('select[name="placeSelect"]');
    await placeSelect.waitFor({ state: 'visible', timeout: 5000 });
    const selectedValue = await placeSelect.inputValue();
    if (selectedValue !== '1') {
      console.log('[🔄] 正在選擇志道樓 - 一樓大活動室...');
      await placeSelect.selectOption('1');
      console.log('[✓] 已選擇志道樓 - 一樓大活動室');
    } else {
      console.log('[✓] 志道樓 - 一樓大活動室已被選中');
    }
  } catch (error) {
    console.error('[❌] 場地選擇失敗：', error);
  }

  // ---- 自動翻頁直到達到指定月份 ----
  async function clickUntilMonth(page: Page, desiredHeaderText: string, maxAttempts = 12): Promise<boolean> {
    const header = page.locator('div.fc-left h2');
    const nextBtn = page.locator('button.fc-next-button');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const text = (await header.textContent())?.trim() || '';
        console.log(`[ℹ] 目前月標題: "${text}" (目標: "${desiredHeaderText}")`);
        if (text === desiredHeaderText) {
          console.log(`[✓] 月份已到：${desiredHeaderText}`);
          return true;
        }
        console.log(`[→] 按下下一頁 (嘗試 ${attempt}/${maxAttempts})`);
        await Promise.all([
          nextBtn.click(),
          page.waitForTimeout(600),
        ]);
      } catch (err) {
        console.warn('[⚠] 點擊或讀取 header 發生錯誤，會重試：', err);
        await page.waitForTimeout(500);
      }
    }
    console.error(`[❌] 超過最大嘗試次數 (${maxAttempts})，仍未到 ${desiredHeaderText}`);
    return false;
  }

  try {
    const desired = '2025年 十一月';
    await clickUntilMonth(page, desired, 20);
  } catch (err) {
    console.error('[❌] 自動翻頁流程失敗：', err);
  }

  // ---- 選取目標日期 ----
  async function selectTargetDate(page: Page, date: string, timeout = 5000): Promise<boolean> {
    if (!date) {
      console.error('[❌] 未設定 TARGET_DATE');
      return false;
    }
    const selector = `td[data-date="${date}"]`;
    try {
      const el = page.locator(selector).first();
      await el.waitFor({ state: 'visible', timeout });
      await el.click({ force: true });
      console.log(`[✓] 已點選目標日期：${date}`);
      return true;
    } catch (err) {
      console.error(`[❌] 無法選取目標日期 ${date}：`, err);
      return false;
    }
  }

  try {
    const targetDate = process.env.TARGET_DATE;
    if (targetDate) {
      await selectTargetDate(page, targetDate, 8000);
    } else {
      console.warn('[⚠] .env 中未設定 TARGET_DATE，跳過選日期步驟');
    }
  } catch (err) {
    console.error('[❌] 選取目標日期流程失敗：', err);
  }

  // ---- 填寫活動名稱 ----
  async function fillAppointmentModal(page: Page, content: string, periodValue = '0', timeout = 5000): Promise<boolean> {
    try {
      const modal = page.locator('#modal_appointment');
      await modal.waitFor({ state: 'visible', timeout });
      const desc = modal.locator('input[name="description"]');
      await desc.waitFor({ state: 'visible', timeout: 2000 });
      await desc.fill(content || '');
      console.log(`[✓] 已填入 description: "${content}"`);

      const period = modal.locator('select[name="period"]');
      await period.waitFor({ state: 'visible', timeout: 2000 });
      await period.selectOption(periodValue);
      console.log(`[✓] 已將 period 設為 value=${periodValue}`);
      return true;
    } catch (err) {
      console.error('[❌] 填寫 appointment modal 失敗：', err);
      return false;
    }
  }

  try {
    const targetContent = process.env.TARGET_CONTENT;
    if (targetContent) {
      await fillAppointmentModal(page, targetContent, '0', 8000);
    } else {
      console.warn('[⚠] .env 中未設定 TARGET_CONTENT，跳過填寫活動名稱');
    }
  } catch (err) {
    console.error('[❌] 填寫彈窗流程失敗：', err);
  }

  // ---- 擷取 SVG 驗證碼 → 白底 PNG ----
  async function fillCaptchaFromTerminal(page: Page, timeout = 8000): Promise<boolean> {
    try {
      const captchaSelector = '#modal_appointment input[name="captcha"]';
      const captchaInput = page.locator(captchaSelector).first();
      await captchaInput.waitFor({ state: 'visible', timeout });

      const screenshotsDir = path.join(process.cwd(), 'screenshots');
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }
      const outPath = path.join(screenshotsDir, 'captcha.png');

      const modalLocator = page.locator('#modal_appointment').first();
      await modalLocator.waitFor({ state: 'visible', timeout: 2000 });

      const svgLocator = modalLocator.locator('#captcha svg').first();
      await svgLocator.waitFor({ state: 'visible', timeout: 4000 });

      const svgContent = await svgLocator.evaluate((el) => el.outerHTML);
      if (!svgContent) throw new Error('找不到 SVG 內容');

      const svgBuffer = Buffer.from(svgContent);
      await sharp(svgBuffer)
        .flatten({ background: '#FFFFFF' }) // 白底
        .png()
        .toFile(outPath);

      console.log(`[✓] 已擷取 SVG 驗證碼並儲存為：${outPath}`);
      console.log('[✅] SVG 轉 PNG 測試完成');

      // 送出本機 API 請求到 ocr_server.py（預設在 http://127.0.0.1:5001/ocr）
      try {
        const apiUrl = 'http://127.0.0.1:5001/ocr';
        // node 18+ 支援全域 fetch；若未支援請自行安裝 node-fetch
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: outPath }),
        });

        // 只解析一次 response body，避免後續使用時重複消耗
        let data: any = null;
        if (!res.ok) {
          const text = await res.text();
          console.error('[❌] OCR server 回應錯誤：', res.status, text);
        } else {
          data = await res.json();
          console.log('[📤] OCR 回傳資料：', JSON.stringify(data, null, 2));
          if (data.items && Array.isArray(data.items)) {
            data.items.forEach((it: any, idx: number) => {
              if (it.formatted) {
                console.log(`[RESULT ${idx}] formatted='${it.formatted}'  raw='${it.raw}'  score=${it.score}  (${it.is_valid ? '符合' : '不符合'})`);
              } else {
                console.log(`[RESULT ${idx}]`, it);
              }
            });
          }
        }
        
        // ===== 新增：將 OCR 回傳的 formatted 值填入 captcha input（但絕對不送出或按 Enter）
        try {
          const items = data && data.items && Array.isArray(data.items) ? data.items : [];
          const firstFormatted = items.find((it: any) => it && it.formatted && String(it.formatted).trim().length > 0);
          if (firstFormatted) {
            const formattedValue = String(firstFormatted.formatted).trim();
            // 填入 input，但不要按下確認或 Enter
            try {
              // 使用 captchaInput（已在外層取得）填值並觸發 input/change 事件
              await captchaInput.fill(formattedValue);
              await captchaInput.evaluate((el, v) => {
                // 保險作法：直接設定 value 並觸發事件
                (el as HTMLInputElement).value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }, formattedValue);
              console.log(`[✓] 已將 OCR 結果填入 captcha 欄位（尚未送出）：${formattedValue}`);

              // 如果有 enterStartTime，計算並輸出耗時，然後清除時間點
              try {
                if (enterStartTime) {
                  const elapsedMs = Date.now() - enterStartTime;
                  const elapsedS = (elapsedMs / 1000).toFixed(3);
                  console.log(`[⏱] 從按下 Enter 到填入 captcha 共 ${elapsedMs} ms (${elapsedS} s)`);
                } else {
                  console.log('[⏱] 未有 Enter 開始時間，無法計算耗時');
                }
              } catch (err) {
                console.warn('[⚠] 計時輸出時發生錯誤：', err);
              } finally {
                enterStartTime = null;
              }
            } catch (err) {
              console.error('[❌] 將 OCR 結果填入 captcha 欄位失敗：', err);
            }
          } else {
            console.log('[ℹ] OCR 回傳沒有可用的 formatted 欄位，未填入 captcha');
          }
        } catch (err) {
          console.warn('[⚠] 嘗試從 OCR 回傳中擷取 formatted 值時發生錯誤：', err);
        }
      } catch (err) {
        console.error('[❌] 無法連線至 OCR server，請確認你已啟動 OCR/ocr_server.py：', err);
      }

      return true;
    } catch (err) {
      console.error('[❌] 擷取 SVG 驗證碼失敗：', err);
      return false;
    }
  }

  // 呼叫測試
  try {
    await fillCaptchaFromTerminal(page, 0);
  } catch (err) {
    console.error('[❌] 填寫驗證碼流程錯誤：', err);
  }

})();
