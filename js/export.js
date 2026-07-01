/**
 * Excel 导出模块
 * 使用 SheetJS (xlsx) 生成符合企业报销单格式的 Excel 文件
 */

const ExportModule = (() => {
    // 类目包装映射：用户选择的类目 → 正式报销类目
    const CATEGORY_PACK_MAP = {
        '差旅': '差旅费',
        '交通补助': '市内交通费',
        '招待费': '业务招待费',
        '餐补': '误餐补助',
        '采购垫资': '采购垫付费',
    };

    /**
     * 导出报销单为 Excel
     * @param {Object} options
     * @param {string} options.reimburser - 报销人
     * @param {string} options.department - 部门
     * @param {string} options.date - 报销日期
     * @param {Array<{category: string, description: string, amount: number}>} options.items - 开支项
     */
    function exportToExcel({ reimburser, department, date, items }) {
        if (!items || items.length === 0) {
            alert('请先添加开支明细');
            return;
        }

        // 按类目汇总
        const categoryTotals = {};
        for (const item of items) {
            const packedCategory = CATEGORY_PACK_MAP[item.category] || item.category;
            if (!categoryTotals[packedCategory]) {
                categoryTotals[packedCategory] = 0;
            }
            categoryTotals[packedCategory] += item.amount;
        }

        const total = items.reduce((sum, item) => sum + item.amount, 0);
        const totalCN = CurrencyCN.toChinese(total);

        // 构建 Excel 数据
        const wsData = [];

        // 标题行
        wsData.push(['', '', '', '', '']);
        wsData.push(['', '', '费  用  报  销  单', '', '']);
        wsData.push(['', '', '', '', '']);

        // 基本信息
        wsData.push(['报销人:', reimburser || '________', '部门:', department || '________', '报销日期:', date || '________']);
        wsData.push(['', '', '', '', '', '']);
        wsData.push(['单据张数:', items.length, '', '', '', '']);

        // 表头
        wsData.push(['', '', '', '', '', '']);
        wsData.push(['序号', '报销类目', '摘要', '金额（元）', '', '']);
        wsData.push(['', '', '', '', '', '']);

        // 明细行（按类目汇总）
        let seq = 1;
        const categoryOrder = Object.keys(categoryTotals);
        for (const cat of categoryOrder) {
            wsData.push([
                seq,
                cat,
                items.filter(i => CATEGORY_PACK_MAP[i.category] === cat)
                    .map(i => i.description)
                    .join('；'),
                categoryTotals[cat] > 0 ? categoryTotals[cat].toFixed(2) : '',
                '',
                '',
            ]);
            seq++;
        }

        // 空行
        wsData.push(['', '', '', '', '', '']);
        wsData.push(['', '', '', '', '', '']);

        // 合计行
        wsData.push(['', '合计（小写）', '', total.toFixed(2), '', '']);
        wsData.push(['', '合计（大写）', '', totalCN, '', '']);

        // 空行
        wsData.push(['', '', '', '', '', '']);
        wsData.push(['', '', '', '', '', '']);

        // 签字区（审核人、审批人自动填充固定值）
        wsData.push(['报销人签字:', reimburser || '', '审核人:', '胡博凯', '审批人:', '陈崇磐']);

        // 创建 Workbook
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // 设置列宽
        ws['!cols'] = [
            { wch: 15 },  // A
            { wch: 20 },  // B
            { wch: 20 },  // C
            { wch: 25 },  // D
            { wch: 15 },  // E
            { wch: 15 },  // F
        ];

        // 合并单元格 - 标题
        ws['!merges'] = [
            { s: { r: 1, c: 1 }, e: { r: 1, c: 4 } },      // 费用报销单 标题
            { s: { r: 3, c: 1 }, e: { r: 3, c: 1 } },      // 报销人标签（实际在第3行）
            { s: { r: 3, c: 3 }, e: { r: 3, c: 4 } },      // 部门标签
            { s: { r: 3, c: 5 }, e: { r: 3, c: 6 } },      // 日期标签
            { s: { r: 8, c: 0 }, e: { r: 8, c: 5 } },      // 表头背景行
            { s: { r: 16, c: 0 }, e: { r: 16, c: 5 } },    // 
            { s: { r: 17, c: 0 }, e: { r: 17, c: 5 } },    // 空行
            { s: { r: 18, c: 1 }, e: { r: 18, c: 2 } },    // 合计小写
            { s: { r: 19, c: 1 }, e: { r: 19, c: 2 } },    // 合计大写
        ];

        // 重新计算合并单元格（基于实际数据行数）
        // 这里我们用基础的行号，SheetJS 会处理

        XLSX.utils.book_append_sheet(wb, ws, '费用报销单');

        // 下载
        const filename = `费用报销单_${reimburser || '未命名'}_${date || ''}.xlsx`;
        XLSX.writeFile(wb, filename);

        return { wb, ws, filename };
    }

    return {
        exportToExcel,
        CATEGORY_PACK_MAP,
    };
})();
