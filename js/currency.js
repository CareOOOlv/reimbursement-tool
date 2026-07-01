/**
 * 中文大写金额转换模块
 * 支持人民币金额转中文大写（如 1234.56 → 壹仟贰佰叁拾肆元伍角陆分）
 */

const CurrencyCN = (() => {
    const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
    const RADICES = ['', '拾', '佰', '仟'];
    const BIG_RADICES = ['', '万', '亿', '兆'];

    /**
     * 将整数部分转换为中文大写
     * @param {number} n - 整数
     * @returns {string}
     */
    function integerToChinese(n) {
        if (n === 0) return '零';

        let result = '';
        let pos = 0; // 当前处理到第几位（0=个位, 1=十位, 4=万位）
        let needZero = false; // 是否需要加"零"

        while (n > 0) {
            const digit = n % 10;
            if (pos % 4 === 0) {
                // 万级或亿级
                result = BIG_RADICES[Math.floor(pos / 4)] + result;
            }

            if (digit === 0) {
                if (result && result[0] !== '零' && result[0] !== BIG_RADICES[1] && result[0] !== BIG_RADICES[2]) {
                    needZero = true;
                }
            } else {
                if (needZero) {
                    result = '零' + result;
                    needZero = false;
                }
                result = DIGITS[digit] + RADICES[pos % 4] + result;
            }

            n = Math.floor(n / 10);
            pos++;
        }

        // 处理"壹拾X"开头的特殊规则（十位在人民币大写中通常写"拾"而非"壹拾"）
        if (result.startsWith('壹拾')) {
            result = result.substring(1);
        }

        return result;
    }

    /**
     * 将小数部分转换为中文大写角分
     * @param {number} jiao - 角（0-9）
     * @param {number} fen - 分（0-9）
     * @returns {string}
     */
    function decimalToChinese(jiao, fen) {
        let result = '';

        if (jiao > 0) {
            result += DIGITS[jiao] + '角';
        } else if (fen > 0) {
            result += '零';
        }

        if (fen > 0) {
            result += DIGITS[fen] + '分';
        }

        if (result === '') {
            result = '整';
        }

        return result;
    }

    /**
     * 将金额转换为中文大写
     * @param {number} amount - 金额（>= 0）
     * @param {boolean} withPrefix - 是否加"人民币"前缀
     * @returns {string}
     */
    function toChinese(amount, withPrefix = true) {
        if (amount < 0) {
            return '（负数）' + toChinese(-amount, withPrefix);
        }

        if (amount === 0) return withPrefix ? '人民币零元整' : '零元整';

        // 分离整数和小数部分
        const str = amount.toFixed(2);
        const parts = str.split('.');
        const integerPart = parseInt(parts[0], 10);
        const jiao = parseInt(parts[1][0], 10);
        const fen = parseInt(parts[1][1], 10);

        let result = '';

        // 整数部分
        if (integerPart > 0) {
            result += integerToChinese(integerPart) + '元';
        } else {
            // 整数部分为0
        }

        // 小数部分
        result += decimalToChinese(jiao, fen);

        // 整数部分为0的情况（如0.50 → 伍角）
        if (integerPart === 0) {
            result = result; // already handled by decimalToChinese
        }

        return withPrefix ? '人民币' + result : result;
    }

    // ---- 公开 API ----

    return {
        toChinese,
    };
})();
