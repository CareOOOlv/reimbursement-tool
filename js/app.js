/**
 * 报销单生成工具 - 主应用逻辑
 * 管理表单操作、预览、导出、OCR 上传等功能
 */

const App = (() => {
    // ---- 状态 ----
    const state = {
        reimburser: '',
        department: '',
        date: '',
        items: [], // 发票录入 [{id, category, description, amount}] — 报销依据
        ocrResults: [], // OCR 识别到的建议条目
        expenses: [], // [{id, amount}] 实际开支 — 用于对比凑单
        nextId: 1,
        nextExpenseId: 1,
    };

    // 类目选项
    const CATEGORIES = ['差旅', '交通补助', '招待费', '餐补', '采购垫资'];

    // ---- 初始化 ----
    function init() {
        setDefaultDate();
        bindEvents();
        addNewRow(); // 默认添加一行
        renderTable();
    }

    function setDefaultDate() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('reimburseDate').value = today;
        state.date = today;
    }

    // ---- 事件绑定 ----
    function bindEvents() {
        // 基本信息输入
        document.getElementById('reimburseName').addEventListener('input', (e) => {
            state.reimburser = e.target.value.trim();
        });
        document.getElementById('reimburseDept').addEventListener('input', (e) => {
            state.department = e.target.value.trim();
        });
        document.getElementById('reimburseDate').addEventListener('change', (e) => {
            state.date = e.target.value;
        });

        // 添加行
        document.getElementById('btnAddRow').addEventListener('click', () => {
            addNewRow();
            renderTable();
        });

        // 清空表格
        document.getElementById('btnClearAll').addEventListener('click', () => {
            if (state.items.length === 0 && state.expenses.length === 0) return;
            if (confirm('确认清空所有发票录入和实际开支？')) {
                state.items = [];
                state.expenses = [];
                state.nextId = 1;
                state.nextExpenseId = 1;
                addNewRow();
                renderTable();
                renderExpenses();
                updateSummary();
            }
        });

        // 合并选中行
        document.getElementById('btnMergeRows').addEventListener('click', mergeSelectedRows);

        // 生成预览
        document.getElementById('btnPreview').addEventListener('click', () => {
            syncTableData();
            if (!validateBeforePreview()) return;
            showPreview();
        });

        // 关闭预览
        document.getElementById('btnClosePreview').addEventListener('click', closePreview);
        document.getElementById('btnClosePreviewBottom').addEventListener('click', closePreview);
        document.getElementById('previewOverlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closePreview();
        });

        // 下载PDF / 打印
        document.getElementById('btnDownloadPdf').addEventListener('click', () => {
            window.print();
        });
        document.getElementById('btnPrint').addEventListener('click', () => {
            window.print();
        });

        // 截图上传
        bindUploadEvents();

        // 实际开支
        bindExpenseEvents();
    }

    function bindUploadEvents() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        let dragCounter = 0;

        uploadArea.addEventListener('click', (e) => {
            if (e.target !== fileInput) fileInput.click();
        });
        fileInput.addEventListener('change', handleFileSelect);

        uploadArea.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            uploadArea.classList.add('drag-over');
        });
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            uploadArea.classList.add('drag-over');
        });
        uploadArea.addEventListener('dragleave', () => {
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                uploadArea.classList.remove('drag-over');
            }
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            uploadArea.classList.remove('drag-over');

            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) {
                processImage(file);
                return;
            }

            // 兼容部分截图工具拖拽的是图片 URL
            const items = e.dataTransfer.items;
            if (items) {
                for (const item of items) {
                    if (item.kind === 'file') {
                        const f = item.getAsFile();
                        if (f) processImage(f);
                        return;
                    }
                    if (item.kind === 'string' && item.type === 'text/uri-list') {
                        item.getAsString((url) => {
                            if (url) fetchImageFromUrl(url);
                        });
                        return;
                    }
                }
            }

            showToast('未检测到可识别的图片文件', 'error');
        });

        // OCR 应用到表格
        document.getElementById('btnApplyOcr').addEventListener('click', applyOcrResults);

        // OCR 全选 / 取消全选
        document.getElementById('ocrSelectAll').addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.ocr-select-item').forEach(cb => {
                cb.checked = checked;
            });
            document.querySelectorAll('.ocr-result-row').forEach(row => {
                row.classList.toggle('selected', checked);
            });
        });
    }

    // ---- 表格数据管理 ----
    function addNewRow() {
        state.items.push({
            id: state.nextId++,
            category: '差旅',
            description: '',
            amount: '',
        });
    }

    function removeRow(id) {
        const index = state.items.findIndex(item => item.id === id);
        if (index !== -1) {
            state.items.splice(index, 1);
        }
        // 保证至少有一行
        if (state.items.length === 0) {
            addNewRow();
        }
        renderTable();
        updateSummary();
    }

    /**
     * 从 DOM 表格同步数据到 state
     */
    function syncTableData() {
        const rows = document.querySelectorAll('#expenseTableBody tr');
        state.items = [];

        rows.forEach((row) => {
            const select = row.querySelector('.cat-select');
            const descInput = row.querySelector('.desc-input');
            const amountInput = row.querySelector('.amount-input');
            const id = parseInt(row.dataset.id, 10);

            const description = descInput ? descInput.value.trim() : '';
            const amountStr = amountInput ? amountInput.value.trim() : '';
            const amount = parseFloat(amountStr);

            if (description || !isNaN(amount)) {
                state.items.push({
                    id,
                    category: select ? select.value : '差旅',
                    description,
                    amount: isNaN(amount) ? 0 : amount,
                });
            }
        });

        // 如果没有有效条目，保留一行空行
        if (state.items.length === 0) {
            state.nextId = 1;
            addNewRow();
            renderTable();
        }
    }

    function updateSummary() {
        syncTableData();
        const validItems = state.items.filter(i => i.description && i.amount > 0);
        const total = validItems.reduce((sum, i) => sum + i.amount, 0);

        const summaryDiv = document.getElementById('summarySection');
        if (validItems.length > 0) {
            summaryDiv.innerHTML = `
                <div class="summary-row">
                    <div>
                        <div class="total-label">合计</div>
                        <div class="total-cn">${CurrencyCN.toChinese(total)}</div>
                    </div>
                    <div class="total-amount">¥ ${total.toFixed(2)}</div>
                </div>
            `;
            summaryDiv.style.display = 'block';
        } else {
            summaryDiv.style.display = 'none';
        }

        // 同步更新凑单进度
        updateProgress();
    }

    // ---- 实际开支管理（用于对比凑单） ----
    function bindExpenseEvents() {
        const input = document.getElementById('invoiceAmountInput');
        const addBtn = document.getElementById('btnAddInvoice');

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addExpense();
            }
        });

        // 限制金额输入格式
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/[^\d.]/g, '');
            const dotIndex = value.indexOf('.');
            if (dotIndex !== -1) {
                value = value.substring(0, dotIndex + 1) + value.substring(dotIndex + 1).replace(/\./g, '');
                if (value.length - dotIndex > 3) value = value.substring(0, dotIndex + 3);
            }
            e.target.value = value;
        });

        addBtn.addEventListener('click', addExpense);
    }

    function addExpense() {
        const input = document.getElementById('invoiceAmountInput');
        const value = parseFloat(input.value.trim());
        if (isNaN(value) || value <= 0) {
            showToast('请输入有效的金额', 'error');
            input.focus();
            return;
        }

        state.expenses.push({
            id: state.nextExpenseId++,
            amount: value,
        });

        input.value = '';
        input.focus();
        renderExpenses();
    }

    function removeExpense(id) {
        state.expenses = state.expenses.filter(i => i.id !== id);
        renderExpenses();
    }

    function renderExpenses() {
        const listDiv = document.getElementById('invoiceList');
        const progressDiv = document.getElementById('invoiceProgress');

        if (state.expenses.length === 0) {
            listDiv.innerHTML = `
                <div class="empty-state" style="padding:24px;">
                    <div class="empty-icon">📭</div>
                    <p>暂无实际开支记录，请在上方输入金额</p>
                </div>
            `;
            progressDiv.style.display = 'none';
            return;
        }

        // 渲染开支标签
        listDiv.innerHTML = state.expenses.map(exp => `
            <span class="invoice-tag">
                ¥${exp.amount.toFixed(2)}
                <button class="tag-del" onclick="App.removeExpense(${exp.id})" title="删除">×</button>
            </span>
        `).join('');

        updateProgress();
    }

    function updateProgress() {
        const progressDiv = document.getElementById('invoiceProgress');
        if (state.expenses.length === 0) {
            progressDiv.style.display = 'none';
            return;
        }

        const validItems = state.items.filter(i => i.description && i.amount > 0);
        const invoiceTotal = validItems.reduce((sum, i) => sum + i.amount, 0); // 发票总额
        const actualExpenses = state.expenses.reduce((sum, i) => sum + i.amount, 0); // 实际开支
        const gap = actualExpenses - invoiceTotal; // 差额：正数表示还需凑发票

        progressDiv.style.display = 'block';

        document.getElementById('invoiceTarget').textContent = `¥ ${actualExpenses.toFixed(2)}`;
        document.getElementById('invoiceActual').textContent = `¥ ${invoiceTotal.toFixed(2)}`;

        const gapEl = document.getElementById('invoiceGap');
        const suggestion = document.getElementById('invoiceSuggestion');
        const progressFill = document.getElementById('invoiceProgressFill');

        if (actualExpenses <= 0) {
            gapEl.textContent = '¥ 0.00';
            gapEl.className = 'stat-value stat-gap';
            suggestion.textContent = '请先添加实际开支和发票录入';
            suggestion.className = 'invoice-suggestion';
            progressFill.style.width = '0%';
        } else if (gap <= 0) {
            gapEl.textContent = `¥ ${Math.abs(gap).toFixed(2)}`;
            gapEl.className = 'stat-value stat-gap over';
            suggestion.textContent = '✅ 发票已覆盖所有实际开支，可以提交报销';
            suggestion.className = 'invoice-suggestion ready';
            progressFill.style.width = '100%';
        } else {
            gapEl.textContent = `¥ ${gap.toFixed(2)}`;
            gapEl.className = 'stat-value stat-gap short';

            // 进度条：发票总额 / 实际开支
            const pct = Math.min(100, (invoiceTotal / actualExpenses) * 100);
            progressFill.style.width = pct + '%';

            // 估算还需要多少张发票
            const avgInvoice = invoiceTotal > 0 ? invoiceTotal / validItems.length : 0;
            if (avgInvoice > 0) {
                const estimated = Math.ceil(gap / avgInvoice);
                suggestion.textContent = `⚠️ 还差 ¥${gap.toFixed(2)}，按当前发票均值，建议再凑约 ${estimated} 张发票`;
            } else {
                suggestion.textContent = `⚠️ 还差 ¥${gap.toFixed(2)}，请先在发票录入表添加发票`;
            }
            suggestion.className = 'invoice-suggestion needed';
        }
    }

    // ---- 表格渲染 ----
    function renderTable() {
        const tbody = document.getElementById('expenseTableBody');

        if (state.items.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6">
                        <div class="empty-state">
                            <div class="empty-icon">📋</div>
                            <p>暂无开支项，点击"添加一行"或上传截图自动识别</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = state.items.map((item, index) => `
            <tr data-id="${item.id}">
                <td class="merge-cell">
                    <input type="checkbox" class="merge-select-item" data-id="${item.id}" onchange="App.onMergeCheckChange()">
                </td>
                <td class="seq-cell">${index + 1}</td>
                <td>
                    <select class="cat-select" onchange="App.updateItem(${item.id}, 'category', this.value)">
                        ${CATEGORIES.map(cat =>
                            `<option value="${cat}" ${item.category === cat ? 'selected' : ''}>${cat}</option>`
                        ).join('')}
                    </select>
                </td>
                <td>
                    <input type="text" class="desc-input"
                        placeholder="如：北京-上海高铁票"
                        value="${escapeHtml(item.description)}"
                        onchange="App.updateItem(${item.id}, 'description', this.value)"
                        oninput="App.updateItem(${item.id}, 'description', this.value)">
                </td>
                <td>
                    <input type="text" class="amount-input"
                        placeholder="0.00"
                        value="${item.amount}"
                        onchange="App.updateItem(${item.id}, 'amount', this.value); App.updateSummary();"
                        oninput="App.handleAmountInput(this, ${item.id}); App.updateSummary();">
                </td>
                <td class="action-cell">
                    <button class="btn-del-row" onclick="App.removeRow(${item.id})" title="删除此行">✕</button>
                </td>
            </tr>
        `).join('');

        updateSummary();
    }

    function updateItem(id, field, value) {
        const item = state.items.find(i => i.id === id);
        if (item) {
            if (field === 'amount') {
                item[field] = value;
            } else {
                item[field] = value;
            }
        }
    }

    function handleAmountInput(inputEl, id) {
        // 限制金额输入格式
        let value = inputEl.value.replace(/[^\d.]/g, '');
        // 只保留第一个小数点
        const dotIndex = value.indexOf('.');
        if (dotIndex !== -1) {
            value = value.substring(0, dotIndex + 1) + value.substring(dotIndex + 1).replace(/\./g, '');
        }
        // 最多两位小数
        if (dotIndex !== -1 && value.length - dotIndex > 3) {
            value = value.substring(0, dotIndex + 3);
        }
        inputEl.value = value;
        updateItem(id, 'amount', value);
    }

    // ---- 合并选中行 ----
    function getSelectedRowIds() {
        const checkboxes = document.querySelectorAll('.merge-select-item:checked');
        return Array.from(checkboxes).map(cb => parseInt(cb.dataset.id, 10));
    }

    function onMergeCheckChange() {
        syncTableData(); // 先把当前编辑同步到 state
        updateMergeButton();
    }

    function toggleSelectAll(checked) {
        document.querySelectorAll('.merge-select-item').forEach(cb => {
            cb.checked = checked;
        });
        syncTableData();
        updateMergeButton();
    }

    function updateMergeButton() {
        const selectedIds = getSelectedRowIds();
        const btn = document.getElementById('btnMergeRows');
        btn.disabled = selectedIds.length < 2;
    }

    function mergeSelectedRows() {
        syncTableData(); // 先同步 DOM 数据
        const selectedIds = getSelectedRowIds();

        if (selectedIds.length < 2) {
            showToast('请至少选择两行进行合并', 'error');
            return;
        }

        const selectedItems = state.items.filter(i => selectedIds.includes(i.id));

        // 合并金额
        const mergedAmount = selectedItems.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

        // 合并描述（用分号+换行拼接，去重）
        const descriptions = selectedItems.map(i => i.description).filter(Boolean);
        const uniqueDescs = [...new Set(descriptions)];
        const mergedDescription = uniqueDescs.join('；');

        // 取第一个的类目
        const mergedCategory = selectedItems[0].category;

        // 创建合并后的行
        const mergedItem = {
            id: state.nextId++,
            category: mergedCategory,
            description: mergedDescription,
            amount: mergedAmount,
        };

        // 从 state 中移除被合并的行，插入合并后的行
        const remainingItems = state.items.filter(i => !selectedIds.includes(i.id));
        state.items = remainingItems;
        state.items.push(mergedItem);

        renderTable();
        updateSummary();
        showToast(`已将 ${selectedIds.length} 行合并为 1 行`, 'success');
    }

    // ---- 截图上传 & OCR ----
    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) processImage(file);
        e.target.value = ''; // 重置，允许再次选择同一文件
    }

    async function fetchImageFromUrl(url) {
        try {
            const resp = await fetch(url);
            const blob = await resp.blob();
            if (!blob.type.startsWith('image/')) {
                showToast('拖拽内容不是图片', 'error');
                return;
            }
            const file = new File([blob], 'dropped-image.png', { type: blob.type });
            processImage(file);
        } catch (err) {
            showToast('无法读取拖拽的图片', 'error');
        }
    }

    async function processImage(file) {
        // 验证文件类型
        if (!file.type.match(/^image\/(jpeg|png|webp|bmp|gif)$/)) {
            showToast('请上传 JPG、PNG、WebP 或 BMP 格式的图片', 'error');
            return;
        }

        // 限制文件大小（20MB）
        if (file.size > 20 * 1024 * 1024) {
            showToast('图片文件不能超过 20MB', 'error');
            return;
        }

        // 显示图片预览
        const preview = document.getElementById('imagePreview');
        preview.src = URL.createObjectURL(file);
        preview.classList.add('active');

        // 显示进度条
        const progressDiv = document.getElementById('ocrProgress');
        const progressBar = document.getElementById('progressBarFill');
        const progressText = document.getElementById('progressText');
        progressDiv.classList.add('active');
        progressBar.style.width = '0%';
        progressText.textContent = '准备识别...';

        // 隐藏之前的结果
        document.getElementById('ocrResults').classList.remove('active');

        try {
            const result = await OcrModule.recognize(file, (percent, status) => {
                progressBar.style.width = percent + '%';
                progressText.textContent = `${status} ${percent}%`;
            });

            state.ocrResults = result.entries;

            // 隐藏进度条
            progressDiv.classList.remove('active');

            // 显示 OCR 结果
            if (result.entries.length === 0) {
                showToast('未能从图片中识别到金额信息，请手动录入', 'error');
                showOcrRawText(result.text);
            } else {
                showOcrResults(result.entries);
            }
        } catch (err) {
            progressDiv.classList.remove('active');
            showToast(err.message || 'OCR 识别失败，请重试', 'error');
            console.error(err);
        }
    }

    function showOcrResults(entries) {
        const resultsDiv = document.getElementById('ocrResults');
        const tbody = document.getElementById('ocrResultsBody');

        tbody.innerHTML = entries.map((entry, index) => `
            <tr class="ocr-result-row selected">
                <td>
                    <input type="checkbox" class="ocr-select-item" checked>
                    <input type="hidden" class="ocr-index" value="${index}">
                </td>
                <td>
                    <select class="ocr-cat-select" onchange="App.onOcrCatChange(${index}, this.value)">
                        ${CATEGORIES.map(cat =>
                            `<option value="${cat}" ${entry.category === cat ? 'selected' : ''}>${catIcon(cat)} ${cat}</option>`
                        ).join('')}
                    </select>
                </td>
                <td>
                    <input type="text" class="ocr-desc-input" value="${escapeHtml(entry.description)}"
                        oninput="App.onOcrDescChange(${index}, this.value)">
                </td>
                <td>
                    <input type="text" class="ocr-amount-input"
                        value="${entry.amount.toFixed(2)}"
                        oninput="App.onOcrAmountInput(this); App.onOcrAmountChange(${index}, this.value)">
                </td>
            </tr>
        `).join('');

        resultsDiv.classList.add('active');

        // 行点击切换选中（但不在 input/select 上触发）
        tbody.querySelectorAll('.ocr-result-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
                const cb = row.querySelector('.ocr-select-item');
                cb.checked = !cb.checked;
                row.classList.toggle('selected', cb.checked);
            });
        });

        showToast(`识别到 ${entries.length} 条开支记录，确认后应用到实际开支`, 'success');
    }

    function onOcrDescChange(index, newDesc) {
        if (state.ocrResults[index]) {
            state.ocrResults[index].description = newDesc;
        }
    }

    function onOcrAmountInput(input) {
        let value = input.value.replace(/[^\d.]/g, '');
        const dotIndex = value.indexOf('.');
        if (dotIndex !== -1) {
            value = value.substring(0, dotIndex + 1) + value.substring(dotIndex + 1).replace(/\./g, '');
            if (value.length - dotIndex > 3) value = value.substring(0, dotIndex + 3);
        }
        input.value = value;
    }

    function onOcrAmountChange(index, value) {
        if (state.ocrResults[index]) {
            state.ocrResults[index].amount = parseFloat(value) || 0;
        }
    }

    function onOcrCatChange(index, newCat) {
        if (state.ocrResults[index]) {
            state.ocrResults[index].category = newCat;
        }
    }

    function showOcrRawText(text) {
        const resultsDiv = document.getElementById('ocrResults');
        const tbody = document.getElementById('ocrResultsBody');

        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="padding:16px;">
                    <p style="font-weight:600; margin-bottom:8px;">识别到的原始文本：</p>
                    <pre style="white-space:pre-wrap; font-size:0.75rem; color:#64748b; background:#f8fafc; padding:12px; border-radius:6px;">${escapeHtml(text)}</pre>
                </td>
            </tr>
        `;
        resultsDiv.classList.add('active');
    }

    function applyOcrResults() {
        if (state.ocrResults.length === 0) return;

        const checkboxes = document.querySelectorAll('.ocr-select-item');
        let addedCount = 0;

        checkboxes.forEach((cb) => {
            if (cb.checked) {
                const index = parseInt(cb.closest('tr').querySelector('.ocr-index').value, 10);
                const entry = state.ocrResults[index];
                if (entry) {
                    state.expenses.push({
                        id: state.nextExpenseId++,
                        amount: entry.amount,
                    });
                    addedCount++;
                }
            }
        });

        renderExpenses();
        updateExpenseProgress();
        document.getElementById('ocrResults').classList.remove('active');
        state.ocrResults = [];

        showToast(`已应用 ${addedCount} 条记录到实际开支`, 'success');
    }

    function catIcon(cat) {
        const icons = { '差旅': '✈️', '交通补助': '🚗', '招待费': '🎁', '餐补': '🍽️', '采购垫资': '🛒' };
        return icons[cat] || '📌';
    }

    // ---- 验证 ----
    function validateBeforePreview() {
        if (!state.reimburser) {
            showToast('请填写报销人姓名', 'error');
            document.getElementById('reimburseName').focus();
            return false;
        }

        const validItems = state.items.filter(i => i.description && i.amount > 0);
        if (validItems.length === 0) {
            showToast('请至少添加一条有效的开支明细', 'error');
            return false;
        }

        // 检查是否有未填全的行
        for (const item of state.items) {
            if ((item.description && !item.amount) || (!item.description && item.amount)) {
                showToast('请注意：部分行描述或金额未填写完整', 'error');
                return false;
            }
        }

        return true;
    }

    // ---- 预览 ----
    function showPreview() {
        const validItems = state.items.filter(i => i.description && i.amount > 0);
        const total = validItems.reduce((sum, i) => sum + i.amount, 0);
        const totalCN = CurrencyCN.toChinese(total);

        const previewItems = document.getElementById('previewItems');
        previewItems.innerHTML = validItems.map((item, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(item.category)}</td>
                <td class="col-desc">${escapeHtml(item.description)}</td>
                <td class="col-amount">${item.amount.toFixed(2)}</td>
            </tr>
        `).join('');

        document.getElementById('previewReimburser').textContent = state.reimburser || '-';
        document.getElementById('previewDept').textContent = state.department || '-';
        document.getElementById('previewDate').textContent = state.date || '-';
        document.getElementById('previewTotal').textContent = `¥ ${total.toFixed(2)}`;
        document.getElementById('previewTotalCN').textContent = totalCN;

        // 签字区：报销人自动填入，审核人/审批人固定
        document.getElementById('previewSigner').textContent = state.reimburser || '';
        document.getElementById('previewReviewer').textContent = '胡博凯';
        document.getElementById('previewApprover').textContent = '陈崇磐';

        document.getElementById('previewOverlay').classList.add('active');
    }

    function closePreview() {
        document.getElementById('previewOverlay').classList.remove('active');
    }

    // ---- Toast ----
    function showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast show ${type}`;
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 2500);
    }

    // ---- 工具 ----
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ---- 公开 API ----
    return {
        init,
        addNewRow,
        removeRow,
        updateItem,
        handleAmountInput,
        updateSummary,
        renderTable,
        onMergeCheckChange,
        toggleSelectAll,
        mergeSelectedRows,
        onOcrCatChange,
        onOcrDescChange,
        onOcrAmountChange,
        onOcrAmountInput,
        removeExpense,
    };
})();

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
