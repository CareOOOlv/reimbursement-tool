/**
 * OCR 截图识别模块 — Tesseract.js 本地识别
 */

const OcrModule = (() => {
    let worker = null;
    let tesseractReady = false;

    // ---- 类目关键词 ----
    const CATEGORY_KEYWORDS = {
        '差旅': [
            '高铁', '火车', '动车', '机票', '航空', '航班', '飞机', '登机',
            '酒店', '住宿', '宾馆', '旅馆', '民宿', '出差', '行程', '列车',
            '车票', '船票', '长途', '客运', '签证', '护照', '行李',
            '携程', '去哪儿', '12306', 'booking',
        ],
        '交通补助': [
            '打车', '出租', '滴滴', '快车', '专车', '顺风车',
            '地铁', '公交', '公交车', '巴士', '停车', '加油',
            '过路', '高速', 'etc', '网约车', '骑行', '共享单车',
            '单车', '曹操', 'T3', '首汽', '花小猪',
        ],
        '招待费': [
            '招待', '宴请', '礼品', '客户', '接待', '送礼',
            '商务', '洽谈', '签约', '合作伙伴', '应酬',
        ],
        '餐补': [
            '餐', '饭', '食', '吃', '外卖', '食堂', '午餐', '晚餐',
            '早餐', '快餐', '便当', '盒饭', '餐厅', '饭店', '美团',
            '饿了么', '饿了吗',
        ],
        '采购垫资': [
            '采购', '垫资', '垫付', '代付', '预支', '采买',
            '购买', '购置', '订货', '进货', '办公用品', '耗材',
            '设备', '器材', '京东', '淘宝', '天猫', '拼多多',
            '发票', '订单', '商品', '物资', '材料', '物料',
        ],
    };

    // ---- 图片预处理 ----
    function preprocessImage(imageSource) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                let width = img.width, height = img.height;
                const minSide = Math.min(width, height);
                let scale = 1;
                if (minSide < 1200) scale = 1200 / minSide;
                else if (minSide > 2400) scale = 2400 / minSide;
                if (scale !== 1) {
                    width = Math.round(width * scale);
                    height = Math.round(height * scale);
                }

                canvas.width = width;
                canvas.height = height;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = reject;

            if (typeof imageSource === 'string') {
                img.src = imageSource;
            } else if (imageSource instanceof Blob || imageSource instanceof File) {
                const url = URL.createObjectURL(imageSource);
                img.src = url;
                img._objectUrl = url;
            } else {
                reject(new Error('不支持的图片格式'));
            }
        });
    }

    function postProcessOcrText(text) {
        return text
            .replace(/([0-9])\s*[Oo]\s*([0-9])/g, '$10$2')
            .replace(/[¥￥]/g, '¥')
            .split('\n')
            .map(line => line.replace(/^[-+~·.。,，;；:\s\u3000]+|[-+~·.。,，;；:\s\u3000]+$/g, '').trim())
            .filter(line => line.length > 0)
            .join('\n');
    }

    // ---- Tesseract 引擎 ----
    async function initTesseract(onProgress) {
        if (tesseractReady && worker) return;
        onProgress && onProgress(0, '下载 Tesseract 引擎...');
        try {
            worker = await Tesseract.createWorker(['chi_sim', 'eng'], 1, {
                logger: (m) => {
                    if (m.status === 'recognizing text') {
                        onProgress && onProgress(Math.round(m.progress * 100), '本地识别中...');
                    } else if (m.status === 'loading language traineddata') {
                        onProgress && onProgress(Math.round(m.progress * 100), '下载语言包...');
                    }
                },
            });
            tesseractReady = true;
        } catch (err) {
            console.error('Tesseract 初始化失败:', err);
            throw new Error('离线 OCR 引擎加载失败，请检查网络后重试');
        }
    }

    // ---- 主识别 ----
    async function recognize(imageSource, onProgress) {
        if (!tesseractReady || !worker) {
            await initTesseract(onProgress);
        }

        let src = imageSource;
        if (imageSource instanceof Blob || imageSource instanceof File) {
            src = URL.createObjectURL(imageSource);
        }

        try {
            onProgress && onProgress(5, '优化图片...');
            const processed = await preprocessImage(src);

            const { data } = await worker.recognize(processed);
            const rawText = data.text || '';
            const text = postProcessOcrText(rawText);

            onProgress && onProgress(100, '识别完成');
            const entries = parseOcrText(text);
            return { text, entries, provider: 'tesseract' };
        } catch (err) {
            console.error('Tesseract 识别失败:', err);
            throw new Error('离线识别失败，请重试或手动录入');
        } finally {
            if (imageSource instanceof Blob || imageSource instanceof File) {
                URL.revokeObjectURL(src);
            }
        }
    }

    // ---- 文本解析 ----

    function isSummaryLine(line) {
        const summaryKeywords = /(?:支出|收入|结余|合计|总计|汇总|累计|总额|总金额|共\s*[¥￥]|总\s*[¥￥]|共\d)/;
        if (summaryKeywords.test(line)) return true;

        const amounts = line.match(/[¥￥-]?\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/g) || [];
        if (amounts.length >= 2 && /(?:支出|收入|结余|合计|总计|汇总|累计|共)/.test(line)) {
            return true;
        }
        return false;
    }

    function suggestCategory(text) {
        const lower = text.toLowerCase();
        let bestCategory = '采购垫资';
        let bestScore = 0;
        for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
            let score = 0;
            for (const kw of keywords) {
                if (lower.includes(kw)) score++;
            }
            if (score > bestScore) {
                bestScore = score;
                bestCategory = category;
            }
        }
        return bestCategory;
    }

    function extractAmount(line) {
        const patterns = [
            /[¥￥]\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/,
            /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2}))\s*元/,
            /金额[：:]\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/,
            /合计[：:]\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/,
            /小写[：:]\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/,
            /实付[：:]\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/,
            /收款[：:]\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/,
            /^[^\d\-+]?(\d+\.\d{2})\s*$/,
            /(\d+\.\d{2})/,
        ];
        for (const pattern of patterns) {
            const m = line.match(pattern);
            if (m) {
                const amount = parseFloat(m[1].replace(/,/g, ''));
                if (amount >= 0.01 && amount <= 1000000) {
                    return { amount, matchText: m[0], start: m.index };
                }
            }
        }
        return null;
    }

    function parseOcrText(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const entries = [];
        const seenKeys = new Set();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/^[-+\s.]+$/.test(line)) continue;

            // 跳过汇总行 / 合计行
            if (isSummaryLine(line)) continue;

            const extracted = extractAmount(line);
            if (!extracted) continue;

            const { amount, matchText, start } = extracted;

            // 跳过超长粘连数字
            const rawDigits = matchText.replace(/[,.\s]/g, '');
            if (rawDigits.length >= 9 && !matchText.includes('.')) continue;

            // 取金额左侧文字作为描述
            let description = line.substring(0, start)
                .replace(/[¥￥:：合计小写金额实付收款\s\u3000]+/g, '')
                .trim();

            if (!description && i > 0) {
                description = lines[i - 1]
                    .replace(/[¥￥:：\s\u3000]+/g, '')
                    .trim();
            }

            if (!description) {
                description = line.replace(matchText, '').trim();
            }

            if (!description) description = '未识别项目';
            if (description.length > 50) description = description.substring(0, 50);

            const category = suggestCategory(description + ' ' + line);
            const key = `${description}_${amount.toFixed(2)}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);

            entries.push({ amount, description, category, rawLine: line });
        }
        return entries;
    }

    async function terminate() {
        if (worker) {
            try { await worker.terminate(); } catch (e) { /* ignore */ }
            worker = null;
            tesseractReady = false;
        }
    }

    return {
        recognize,
        parseOcrText,
        suggestCategory,
        terminate,
    };
})();
