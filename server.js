const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT_DIR = __dirname;
const ENV_PATH = path.join(ROOT_DIR, '.env');

function loadDotEnv(filePath) {
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) return;

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (!(key in process.env)) {
            process.env[key] = value;
        }
    });
}

loadDotEnv(ENV_PATH);

function getPositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const BUILTIN_APP_LLM = {
    baseUrl: 'http://106.75.4.152:3000/v1',
    apiKey: 'sk-xozA8YabCRSWBoP7xkqSoryaUIuKDJuJyodv9PGIKsskKXN9',
    model: 'gpt-5.5',
};

const CONFIG = {
    port: Number(process.env.PORT || 8787),
    host: process.env.HOST || '127.0.0.1',
    appLlmBaseUrl: process.env.APP_LLM_BASE_URL || process.env.OPENAI_BASE_URL || BUILTIN_APP_LLM.baseUrl,
    appLlmApiKey: process.env.APP_LLM_API_KEY || process.env.OPENAI_API_KEY || BUILTIN_APP_LLM.apiKey,
    appLlmModel: process.env.APP_LLM_MODEL || process.env.OPENAI_MODEL || BUILTIN_APP_LLM.model,
    cozeApiUrl: process.env.COZE_API_URL || '',
    cozePat: process.env.COZE_PAT || '',
    cozeBotId: process.env.COZE_BOT_ID || '',
    cozeUserId: process.env.COZE_USER_ID || 'resume-site-visitor',
    cozeConversationId: process.env.COZE_CONVERSATION_ID || '',
    cozeAppendSystemPrompt: process.env.COZE_APPEND_SYSTEM_PROMPT === 'true',
    cozePollIntervalMs: getPositiveNumber(process.env.COZE_POLL_INTERVAL_MS, 1500),
    cozePollMaxAttempts: getPositiveNumber(process.env.COZE_POLL_MAX_ATTEMPTS, 40),
};

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
};

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
}

function safeJoin(rootDir, pathname) {
    const decodedPath = decodeURIComponent(pathname);
    const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
    return path.join(rootDir, normalizedPath);
}

function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';

        req.on('data', (chunk) => {
            data += chunk;
            if (data.length > 2 * 1024 * 1024) {
                reject(new Error('请求体过大'));
                req.destroy();
            }
        });

        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (error) {
                reject(new Error('请求体不是合法 JSON'));
            }
        });

        req.on('error', reject);
    });
}

function buildCozePayload(messages) {
    const additionalMessages = (Array.isArray(messages) ? messages : [])
        .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
        .map((message) => ({
            role: message.role,
            content: message.content,
            content_type: 'text',
        }));

    const payload = {
        bot_id: CONFIG.cozeBotId,
        user_id: CONFIG.cozeUserId,
        stream: false,
        auto_save_history: true,
        additional_messages: additionalMessages,
    };

    if (CONFIG.cozeConversationId) {
        payload.conversation_id = CONFIG.cozeConversationId;
    }

    return payload;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCozeEndpoint(pathname) {
    const base = new URL(CONFIG.cozeApiUrl);
    base.pathname = pathname;
    base.search = '';
    return base.toString();
}

function tryExtractText(value) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (!value || typeof value !== 'object') return '';

    if (typeof value.text === 'string' && value.text.trim()) return value.text.trim();
    if (typeof value.content === 'string' && value.content.trim()) return value.content.trim();
    if (typeof value.answer === 'string' && value.answer.trim()) return value.answer.trim();
    if (typeof value.output === 'string' && value.output.trim()) return value.output.trim();

    return '';
}

function extractCozeReply(data) {
    const directCandidates = [
        data?.content,
        data?.answer,
        data?.data?.content,
        data?.data?.answer,
        data?.message?.content,
        data?.data?.message?.content,
    ];

    for (const candidate of directCandidates) {
        const text = tryExtractText(candidate);
        if (text) return text;
    }

    const messageGroups = [
        data?.messages,
        data?.data?.messages,
        data?.data?.message_list,
        data?.message_list,
    ];

    for (const group of messageGroups) {
        if (!Array.isArray(group)) continue;

        const preferred = group
            .filter((item) => item && typeof item === 'object')
            .filter((item) => {
                const role = String(item.role || '').toLowerCase();
                const type = String(item.type || '').toLowerCase();
                return role.includes('assistant') || type.includes('answer');
            })
            .reverse();

        for (const item of preferred) {
            const text = tryExtractText(item);
            if (text) return text;
        }

        for (const item of group) {
            const text = tryExtractText(item);
            if (text) return text;
        }
    }

    return '';
}

function extractCozeAnswerFromMessages(messages) {
    if (!Array.isArray(messages)) return '';

    const answerMessage = [...messages]
        .reverse()
        .find((item) => item?.type === 'answer' && String(item?.role || '').toLowerCase() === 'assistant');

    if (answerMessage?.content && typeof answerMessage.content === 'string') {
        return answerMessage.content.trim();
    }

    return extractCozeReply({ messages });
}

function safeJsonSnippet(value, maxLength = 700) {
    if (value == null) return '';

    let text = '';
    if (typeof value === 'string') {
        text = value;
    } else {
        try {
            text = JSON.stringify(value);
        } catch (error) {
            text = String(value);
        }
    }

    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength)}...`;
}

function extractCozeFailureDetail(data) {
    const detailCandidates = [
        data?.msg,
        data?.message,
        data?.error,
        data?.detail,
        data?.data?.msg,
        data?.data?.message,
        data?.data?.error,
        data?.data?.detail,
        data?.data?.error_message,
        data?.data?.error_msg,
        data?.data?.last_error,
        data?.data?.last_error_message,
        data?.data?.last_error_msg,
        data?.data?.failed_reason,
        data?.data?.failure_reason,
        data?.data?.reason,
        data?.data?.status_message,
        data?.data?.debug_url,
    ];

    const details = [];
    for (const candidate of detailCandidates) {
        const snippet = safeJsonSnippet(candidate, 280);
        if (snippet && !details.includes(snippet)) {
            details.push(snippet);
        }
    }

    const messageGroups = [
        data?.messages,
        data?.data?.messages,
        data?.data?.message_list,
        data?.message_list,
        data?.data,
    ];

    for (const group of messageGroups) {
        if (!Array.isArray(group)) continue;

        for (const item of group) {
            const role = String(item?.role || '').toLowerCase();
            const type = String(item?.type || '').toLowerCase();
            const content = safeJsonSnippet(
                item?.error ||
                item?.message ||
                item?.content ||
                item?.detail,
                240
            );

            if (!content) continue;
            if (!role.includes('assistant') && !type.includes('error') && !type.includes('tool')) continue;
            if (!details.includes(content)) {
                details.push(content);
            }
        }
    }

    return details.slice(0, 3).join(' | ');
}

function mergeSystemIntoMessages(system, messages) {
    const systemParts = [];
    if (system) systemParts.push(system);

    const history = (Array.isArray(messages) ? messages : [])
        .filter((message) => message && (message.role === 'user' || message.role === 'assistant' || message.role === 'system'))
        .map((message) => {
            if (message.role === 'system') {
                systemParts.push(message.content || '');
                return null;
            }

            return {
                role: message.role,
                content: String(message.content || ''),
            };
        })
        .filter(Boolean);

    if (!history.length) {
        history.push({ role: 'user', content: '请开始。' });
    }

    const systemText = systemParts.filter(Boolean).join('\n\n').trim();
    if (systemText) {
        const firstUser = history.find((message) => message.role === 'user');
        if (firstUser) {
            firstUser.content = `[系统说明]\n${systemText}\n\n[用户消息]\n${firstUser.content}`;
        } else {
            history.unshift({ role: 'user', content: `[系统说明]\n${systemText}` });
        }
    }

    return history;
}

const RESUME_PROMPT_MARKERS = [
    '你是管开祥的AI简历助手',
    '管开祥的简历信息',
    '只回答与管开祥简历相关',
];

function isResumeAssistantPrompt(text) {
    const value = String(text || '');
    return RESUME_PROMPT_MARKERS.some((marker) => value.includes(marker));
}

function sanitizeAppLlmBody(body = {}) {
    const cleaned = { ...body };

    // /llm-api/* is reserved for non-resume apps. If the resume assistant prompt
    // is accidentally reused there, drop it so app-specific prompts stay isolated.
    if (isResumeAssistantPrompt(cleaned.system)) {
        delete cleaned.system;
    }

    if (Array.isArray(cleaned.messages)) {
        cleaned.messages = cleaned.messages.filter((message) => (
            message?.role !== 'system' || !isResumeAssistantPrompt(message.content)
        ));
    }

    return cleaned;
}

function parseModelJson(text) {
    let value = String(text || '').trim();
    const fence = value.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) value = fence[1].trim();

    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) {
        value = value.slice(start, end + 1);
    }

    const cleaned = value
        .replace(/,\s*,/g, ',')
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([{[])\s*,/g, '$1');

    for (const candidate of [value, cleaned]) {
        try {
            return JSON.parse(candidate);
        } catch (error) {
            // Try the next relaxed candidate.
        }
    }

    throw new Error('无法解析模型返回的 JSON');
}

const PARADIGM_BRIEF = `
【toC】
chat 对话即产品：LLM 即界面，用户自带任务。适合通用助手。
companion 角色陪伴：人格化角色，卖情感与时长。适合陪伴/娱乐/社交。
create 创作工具：可反复打磨的产出物，人在环里。适合内容/设计/生产力。
copilot 嵌入式 Copilot：把 AI 塞进已有高频场景，0 迁移成本。适合已有产品提粘性。
agent 任务代理：给目标自动拆解执行，人只验收。适合复杂多步任务。
answer 答案引擎：AI 隐形，用 AI 重做某个老品类拉开体验代差。适合搜索/问答/决策。
router 聚合/路由层：聚合多模型做分发与对比。适合平台/入口/开发者。
【toB】
rag 企业知识库问答：把企业文档变成可问答、可溯源的知识中枢。适合内部知识/客服/售前/合规。
bizcopilot 行业 SaaS 副驾：嵌入 CRM/HR/法务等业务系统，读写业务对象。适合给已有 B 端系统提效。
support 智能客服：自动应答 + 坐席辅助，可溯源可转人工。适合客服/售后/服务台。
bizagent 流程自动化 Agent：跨系统执行业务流程，不可逆动作人工审批。适合订单/运维/财务/HR 流程。
bi 对话式数据分析：自然语言转 SQL、自助查数出报表。适合 BI/经营分析/降低看数门槛。
docintel 文档智能：合同/发票/报告的抽取、审阅、比对。适合法务/采购/财务等文档密集场景。
platform 企业 AI 平台：统一模型接入、Agent 编排、评测监控与护栏治理。适合企业 AI 中台/平台团队。
`;

const RESUME_FALLBACK_SYSTEM_PROMPT = `
你是管开祥的AI简历助手。
只基于下面提供的简历与项目知识回答，不要编造，不要输出与简历无关的内容。
如果问题超出资料范围，礼貌说明无法确认，并尽量给出可参考的方向。
回答要求简洁、专业、分段输出；有多个要点时优先使用编号或短列表。
`.trim();

const RESUME_PROFILE_BLOCK = `
【个人背景】
- 姓名：管开祥
- 求职方向：AI产品经理
- 地点：上海
- 经验：6年以上产品经理经验，近3年持续聚焦企业服务场景AI产品落地
- 核心能力：AI产品规划与0-1落地、模型选型、RAG、Prompt设计、知识库建设、工作流编排、效果评测与迭代闭环、跨团队协同与项目交付
- 行业经验：电信客服、医疗、教育、金融合规、司法
`.trim();

const PROJECT_KNOWLEDGE_BLOCK = `
【项目知识】
1. 上海电信智能客服项目
- 服务对象：上海电信客服与B端/G端客户，覆盖套餐咨询、套餐推荐、进度查询、售后服务。
- 背景与痛点：提升客服效率，替代部分人工；客服人员流动大、培训成本高；用户等待时间长，难以快速找到合适套餐。
- 方案：Prompt + 知识库（套餐信息、权益解释等）+ 函数调用 + ask human help + 多模态模型（Qwen3-30B-A3B、Qwen3-8B-VL）。
- 细节：长对话只保留最近10轮和关键轮次，配合结构化摘要缓存，减少上下文膨胀；支持非标准化诉求处理与套餐排序。
- 结果：推荐准确率98%+，意图识别准确率92%+，套餐订购率30.7%，AI渠道承接近50%套餐咨询流量。

2. 中医大模型项目（龙华医院）
- 服务对象：医生与中医临床业务，覆盖病历质控、中医临床辅助决策、方剂查询与临床知识查询。
- 背景与痛点：病历质控依赖人工抽检，覆盖面低、标准不一；临床诊断场景复杂，需要“外脑”辅助。
- 方案：本地化部署开源模型，使用微调后的方证大模型（qwen3-8b）+ 知识库 + Prompt；RAG 覆盖方剂、中药、诊疗指南、膏方、ICD10 等。
- 细节：病历质控按“依据 + 问题病历 + 修改建议”构造问答对，并按病种分类；临床决策按病-证-症-方-药链路输出。
- 结果：问答准确率约86%，病历修改时间降低约80%，诊疗效率提升30%+。

3. 智能教学平台（浙江财经大学）
- 服务对象：教师与学生，覆盖备课、出题、教案、课件、批改与个性化练习。
- 背景与痛点：教师备课与批改耗时，学生需要个性化学习内容。
- 方案：Prompt + 教学大模型（Qwen2.5 72B / 32B）+ 教材与课件知识库 + PPT 生成插件 + 反馈闭环；出题用数学模型检查。
- 细节：RAG 采用结构化题目、父子级切片教案/教材；支持在线修改、重新生成、版本管理。
- 结果：出题准确率95%+，教案修改比例约20%以内，课件可直接使用但仍需少量调整。

4. 无锡检察院智能办案平台
- 服务对象：检察院业务部门，覆盖类案发现、审查报告生成、三书比对、文书与总结撰写。
- 背景与痛点：案件资料多、处理链路长，人工整理和比对成本高。
- 方案：文件解析 + 案件知识库 + Prompt + Qwen-32B / Qwen-Coder。
- 结果：信息提取准确率98%+，法条/引用准确率89%左右，生成内容可用率95%+。

5. 汇丰银行智能监管平台
- 服务对象：监管/合规部门，覆盖外规内化、监管报告撰写、新闻稿撰写。
- 背景与痛点：需要把外部监管规则转成内部可执行要求，并提升内容产出效率。
- 方案：Prompt + 企业知识库 + 文件解析 + 行内模型；把外规拆成条款级结构，再做内外规匹配与内容生成。
- 细节：依赖用户在线修改沉淀反馈，持续优化准确性、引用匹配和可用性。
- 结果：知识问答准确率87.1%，引用准确率89.4%，报告撰写可用率78.5%。

6. 医疗AIGC智能问答系统（脑医汇）
- 服务对象：脑科学相关医疗问答与资料查询。
- 背景与痛点：医疗场景强调专业性、准确性与合规。
- 方案：智能问答产品规划 + 医学知识库 + RAG + Prompt + 反馈闭环。
- 结果：上线两周约1.6万人使用，二次使用及以上占比60%+，单用户单次平均对话4.3条。
`.trim();

function buildResumeFallbackSystemPrompt() {
    return `${RESUME_FALLBACK_SYSTEM_PROMPT}\n\n${RESUME_PROFILE_BLOCK}\n\n${PROJECT_KNOWLEDGE_BLOCK}`;
}

function getAppLlmUrl() {
    if (!CONFIG.appLlmBaseUrl) return '';

    const trimmed = CONFIG.appLlmBaseUrl.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(trimmed)) {
        return trimmed;
    }

    return `${trimmed}/chat/completions`;
}

function buildOpenAiCompatibleMessages(system, messages) {
    const out = [];
    if (system) {
        out.push({ role: 'system', content: system });
    }

    (Array.isArray(messages) ? messages : [])
        .filter((message) => message && (message.role === 'user' || message.role === 'assistant' || message.role === 'system'))
        .forEach((message) => {
            out.push({
                role: message.role,
                content: String(message.content || ''),
            });
        });

    if (!out.some((message) => message.role === 'user')) {
        out.push({ role: 'user', content: '请开始。' });
    }

    return out;
}

async function callOpenAiCompatibleLlm(body, options = {}) {
    const url = getAppLlmUrl();
    if (!url || !CONFIG.appLlmApiKey || !CONFIG.appLlmModel) {
        throw new Error('应用模型配置不完整。请检查内置配置或环境变量 APP_LLM_BASE_URL、APP_LLM_API_KEY、APP_LLM_MODEL。');
    }

    const system = [body.system, options.system].filter(Boolean).join('\n\n');
    const messages = buildOpenAiCompatibleMessages(system, body.messages);
    const payload = {
        model: CONFIG.appLlmModel || 'gpt-5.4',
        messages,
        temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7,
    };

    const maxTokens = Number(body.max_tokens || body.maxTokens);
    if (Number.isFinite(maxTokens) && maxTokens > 0) {
        payload.max_tokens = maxTokens;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${CONFIG.appLlmApiKey}`,
        },
        body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let data;
    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
        data = { raw: rawText };
    }

    if (!response.ok) {
        throw new Error(`应用模型请求失败: ${response.status} ${rawText}`);
    }

    const text = extractOpenAiCompatibleText(data);
    if (!text) {
        throw new Error(`未能从应用模型响应中提取回答: ${rawText}`);
    }

    return text;
}

function extractOpenAiCompatibleText(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) return content.trim();

    const text = data?.choices?.[0]?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();

    return tryExtractText(data);
}

async function callAppLlmFromBody(body, options = {}) {
    const url = getAppLlmUrl();
    if (!url || !CONFIG.appLlmApiKey || !CONFIG.appLlmModel) {
        // If the app-model channel is unavailable, reuse the Coze path so
        // other demos still have a chance to answer instead of hard failing.
        const system = [body.system, options.system].filter(Boolean).join('\n\n');
        const messages = mergeSystemIntoMessages(system, body.messages);
        return callCoze(messages);
    }

    return callOpenAiCompatibleLlm(body, options);
}

function writeText(res, text) {
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(text);
}

async function sendLlmText(res, body, options = {}) {
    const text = await callAppLlmFromBody(body, options);
    if (options.stream) {
        writeText(res, text);
        return;
    }

    sendJson(res, 200, { text });
}

function jsonOnlySystem(schema) {
    return [
        '你必须只输出合法 JSON，不要输出 Markdown 代码块，不要解释。',
        schema ? `JSON 结构要求：${JSON.stringify(schema)}` : '',
    ].filter(Boolean).join('\n');
}

async function fetchCozeMessageList(conversationId, chatId) {
    const messageListUrl = new URL(getCozeEndpoint('/v3/chat/message/list'));
    messageListUrl.searchParams.set('conversation_id', conversationId);
    messageListUrl.searchParams.set('chat_id', chatId);

    const messageListResponse = await fetch(messageListUrl, {
        headers: {
            Authorization: `Bearer ${CONFIG.cozePat}`,
        },
    });

    const messageListRawText = await messageListResponse.text();
    let messageListData;
    try {
        messageListData = messageListRawText ? JSON.parse(messageListRawText) : {};
    } catch (error) {
        messageListData = { raw: messageListRawText };
    }

    if (!messageListResponse.ok || messageListData?.code !== 0) {
        throw new Error(`Coze 拉取消息失败: ${messageListResponse.status} ${messageListRawText}`);
    }

    return {
        rawText: messageListRawText,
        data: messageListData,
        reply: extractCozeAnswerFromMessages(messageListData?.data),
    };
}

async function callCoze(messages) {
    if (!CONFIG.cozeApiUrl || !CONFIG.cozePat || !CONFIG.cozeBotId) {
        throw new Error(
            'Coze 配置不完整。请在 .env 中填写 COZE_API_URL、COZE_PAT、COZE_BOT_ID。'
        );
    }

    const payload = buildCozePayload(messages);

    const createResponse = await fetch(CONFIG.cozeApiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${CONFIG.cozePat}`,
        },
        body: JSON.stringify(payload),
    });

    const createRawText = await createResponse.text();
    let createData;

    try {
        createData = createRawText ? JSON.parse(createRawText) : {};
    } catch (error) {
        createData = { raw: createRawText };
    }

    if (!createResponse.ok || createData?.code !== 0) {
        throw new Error(`Coze 创建会话失败: ${createResponse.status} ${createRawText}`);
    }

    const chatId = createData?.data?.id;
    const conversationId = createData?.data?.conversation_id;

    if (!chatId || !conversationId) {
        throw new Error(`Coze 创建会话成功，但缺少 chat_id 或 conversation_id: ${createRawText}`);
    }

    const retrieveUrl = new URL(getCozeEndpoint('/v3/chat/retrieve'));
    retrieveUrl.searchParams.set('conversation_id', conversationId);
    retrieveUrl.searchParams.set('chat_id', chatId);

    let finalStatus = '';
    let lastRetrieveRawText = '';
    for (let attempt = 0; attempt < CONFIG.cozePollMaxAttempts; attempt += 1) {
        if (attempt > 0) {
            await sleep(CONFIG.cozePollIntervalMs);
        }

        const retrieveResponse = await fetch(retrieveUrl, {
            headers: {
                Authorization: `Bearer ${CONFIG.cozePat}`,
            },
        });

        const retrieveRawText = await retrieveResponse.text();
        lastRetrieveRawText = retrieveRawText;
        let retrieveData;
        try {
            retrieveData = retrieveRawText ? JSON.parse(retrieveRawText) : {};
        } catch (error) {
            retrieveData = { raw: retrieveRawText };
        }

        if (!retrieveResponse.ok || retrieveData?.code !== 0) {
            throw new Error(`Coze 查询状态失败: ${retrieveResponse.status} ${retrieveRawText}`);
        }

        finalStatus = retrieveData?.data?.status || '';
        if (finalStatus === 'completed') {
            break;
        }

        if (finalStatus === 'failed' || finalStatus === 'canceled') {
            let detail = extractCozeFailureDetail(retrieveData);

            try {
                const fallbackMessageList = await fetchCozeMessageList(conversationId, chatId);
                if (fallbackMessageList.reply) {
                    return fallbackMessageList.reply;
                }

                const messageListDetail = extractCozeFailureDetail(fallbackMessageList.data);
                if (messageListDetail) {
                    detail = detail ? `${detail} | ${messageListDetail}` : messageListDetail;
                }
            } catch (error) {
                console.warn('[coze failure fallback message list failed]', error.message);
            }

            const suffix = detail
                ? `，详情：${detail}`
                : `。retrieve=${safeJsonSnippet(retrieveRawText, 500)}`;
            throw new Error(`Coze 会话执行失败，状态为 ${finalStatus}${suffix}`);
        }
    }

    if (finalStatus !== 'completed') {
        try {
            const fallbackMessageList = await fetchCozeMessageList(conversationId, chatId);
            if (fallbackMessageList.reply) {
                return fallbackMessageList.reply;
            }
        } catch (error) {
            console.warn('[coze fallback message list failed]', error.message);
        }

        throw new Error(
            `Coze 会话超时，最终状态为 ${finalStatus || 'unknown'}。` +
                `当前轮询配置为 ${CONFIG.cozePollMaxAttempts} 次，每次间隔 ${CONFIG.cozePollIntervalMs}ms。` +
                `如需更久等待，可在 .env 中调大 COZE_POLL_MAX_ATTEMPTS 或 COZE_POLL_INTERVAL_MS。` +
                ` retrieve=${lastRetrieveRawText}`
        );
    }

    let reply = '';
    let lastMessageListRawText = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
            await sleep(600);
        }

        const messageListResult = await fetchCozeMessageList(conversationId, chatId);
        lastMessageListRawText = messageListResult.rawText;
        if (messageListResult.reply) {
            reply = messageListResult.reply;
            break;
        }
    }

    if (!reply) {
        throw new Error(`未能从 Coze 消息列表中提取回答: ${lastMessageListRawText}`);
    }

    return reply;
}

const server = http.createServer(async (req, res) => {
    try {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);

        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            });
            res.end();
            return;
        }

        if (req.method === 'POST' && requestUrl.pathname.startsWith('/llm-api/')) {
            const body = sanitizeAppLlmBody(await getRequestBody(req));
            const endpoint = requestUrl.pathname.replace('/llm-api/', '');

            if (endpoint === 'chat') {
                await sendLlmText(res, body, { stream: true });
                return;
            }

            if (endpoint === 'complete') {
                const extraSystem = body.format ? jsonOnlySystem(body.format.schema || body.format) : '';
                await sendLlmText(res, body, { system: extraSystem });
                return;
            }

            if (endpoint === 'answer') {
                const query = String(body.query || '').trim();
                if (!query) {
                    sendJson(res, 400, { error: 'query 不能为空' });
                    return;
                }

                const text = await callAppLlmFromBody({
                    system: '你是答案引擎。用中文给出结构化、准确、简洁的回答：先给一句直接结论，再分点展开。不要复述问题。',
                    messages: [{ role: 'user', content: query }],
                });
                sendJson(res, 200, {
                    text,
                    sources: [],
                    note: '当前内嵌版本走应用模型代理，未启用外部联网检索；答案来自模型自身能力。',
                });
                return;
            }

            if (endpoint === 'build-demo') {
                await sendLlmText(res, {
                    system:
                        '你是资深前端工程师。只输出一个可嵌入页面的单文件 demo 片段，包含 <style>、HTML 结构和 <script>，不要 Markdown 代码块，不要解释文字。需要 AI 能力时调用已注入的 await AI(prompt, { system })。',
                    messages: [{
                        role: 'user',
                        content:
                            `【范式】${body.paradigm || ''}\n【产品】${body.productName || ''}\n\n` +
                            `【Demo 设想】\n${body.spec || ''}\n\n请生成可交互 HTML 原型。`,
                    }],
                }, { stream: true });
                return;
            }

            if (endpoint === 'prd' || endpoint === 'proposal' || endpoint === 'revise') {
                const prompt = endpoint === 'prd'
                    ? `请基于以下产品信息生成一份中文 PRD，包含产品概述、用户角色、核心功能、LLM 逻辑、非功能需求、埋点、风险与应对。\n\n${JSON.stringify(body.product || {}, null, 2)}`
                    : endpoint === 'proposal'
                        ? `请基于以下信息生成一份中文 AI 产品升级提案，包含背景、目标、数据、升级策略、Demo、需求、市场、计划。\n\n${JSON.stringify(body, null, 2)}`
                        : `请根据评审意见修订文档。\n\n【文档】\n${body.doc || ''}\n\n【评审意见】\n${body.review || ''}`;
                await sendLlmText(res, {
                    system: '你是资深 AI 产品经理。输出中文 Markdown，具体、可落地、不要空话。',
                    messages: [{ role: 'user', content: prompt }],
                }, { stream: true });
                return;
            }

            if (endpoint === 'advise') {
                const product = body.product || {};
                const goal = String(body.goal || '').slice(0, 2000);
                const system = [
                    `你是资深 AI 产品顾问，熟悉 LLM 产品的 14 种范式：\n${PARADIGM_BRIEF}`,
                    '用户会给出他们的产品信息和目标/问题。请输出：',
                    '1) diagnosis：3-4 步“专家诊断”，每步一个角度 title + 一针见血的 insight，像顾问当面对话一样具体、犀利、可落地，结合用户产品本身，不要空泛套话。',
                    '2) recommended：从 chat, companion, create, copilot, agent, answer, router, rag, bizcopilot, support, bizagent, bi, docintel, platform 中选择最合适的范式 id。',
                    '3) paradigmName 给中文名；why 给推荐理由，必须结合该产品的目标/问题。',
                    '4) runnerUp / runnerUpWhy：次优范式及一句话理由。',
                    '5) productProposal：把推荐范式具体应用到“用户这个产品”的方案，结合其定位/人群/功能给出具体形态，而非通用描述。',
                    '6) demoIdea：对应的最小可玩 demo 设想，包含界面、核心交互、用到的模型能力。',
                    '7) cautions：该产品落地这个范式要注意的 3-5 个要点。',
                    '只输出合法 JSON，不要 Markdown，不要代码块。JSON 字段必须是 diagnosis, recommended, paradigmName, why, runnerUp, runnerUpWhy, productProposal, demoIdea, cautions。',
                ].join('\n');
                const userMsg =
                    `【产品信息】\n名称：${product.name || '(未填)'}\n定位：${product.positioning || '(未填)'}\n` +
                    `目标人群：${product.audience || '(未填)'}\n界面/形态：${product.ui || '(未填)'}\n` +
                    `主要功能：${product.features || '(未填)'}\n${product.stage ? `阶段：${product.stage}\n` : ''}` +
                    `\n【目标 / 当前问题】\n${goal || '(未填)'}`;
                const text = await callAppLlmFromBody({
                    system,
                    messages: [{ role: 'user', content: userMsg }],
                    max_tokens: 6000,
                    temperature: 0.55,
                });

                try {
                    sendJson(res, 200, parseModelJson(text));
                } catch (error) {
                    const fixed = await callAppLlmFromBody({
                        system: '你是 JSON 修复器。把用户给的文本修复成合法 JSON，只输出 JSON 本身，不要解释、不要代码块。',
                        messages: [{ role: 'user', content: text }],
                        max_tokens: 6000,
                        temperature: 0,
                    });
                    sendJson(res, 200, parseModelJson(fixed));
                }
                return;
            }

            if (endpoint === 'fit' || endpoint === 'review' || endpoint === 'bmc' || endpoint === 'monetize' || endpoint === 'roi' || endpoint === 'compete' || endpoint === 'compare') {
                const schemas = {
                    fit: '返回 JSON：{"scores":[{"id":"chat","score":80,"reason":"理由"}]}。id 从 chat, companion, create, copilot, agent, answer, router, rag, bizcopilot, support, bizagent, bi, docintel, platform 中选择。',
                    review: '返回 JSON：{"score":80,"issues":[{"severity":"high","title":"问题","detail":"说明","suggestion":"建议"}],"summary":"总结"}。',
                    bmc: '返回 JSON：{"segments":[],"valuePropositions":[],"channels":[],"relationships":[],"revenueStreams":[],"keyResources":[],"keyActivities":[],"keyPartners":[],"costStructure":[]}。',
                    monetize: '返回 JSON：{"model":"商业模式","pricing":[{"tier":"版本","price":"价格","forWho":"适合对象"}],"funnel":[{"stage":"阶段","metric":"指标","action":"动作"}],"metrics":["指标"],"risks":["风险"]}。',
                    roi: '返回 JSON：{"currency":"元","horizonMonths":12,"scenarios":[{"name":"保守","users":10000,"payRate":5,"arpuMonthly":49,"grossMargin":70,"cac":20,"fixedCostMonthly":10000}]}。',
                    compete: '返回 JSON：{"summary":"总结","paradigms":[{"id":"chat","role":"主要","reason":"原因"}],"strengths":[],"weaknesses":[],"inspirations":[],"sources":[]}。',
                    compare: '返回 JSON：{"summary":"总结","products":[],"matrix":[],"takeaways":[]}。',
                };
                const text = await callAppLlmFromBody({
                    system: `你是资深 AI 产品策略顾问。${schemas[endpoint]}只输出合法 JSON，不要 Markdown。`,
                    messages: [{ role: 'user', content: JSON.stringify(body, null, 2) }],
                });
                try {
                    sendJson(res, 200, JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')));
                } catch (error) {
                    sendJson(res, 200, { text });
                }
                return;
            }

            if (endpoint === 'prd-outline') {
                sendJson(res, 200, { tagline: '', version: 'V1.0.0', personas: [], modules: [] });
                return;
            }

            if (endpoint === 'prd-section') {
                const chapter = body.chapter || {};
                const text = await callAppLlmFromBody({
                    system: '你是资深 AI 产品经理。输出中文 Markdown。',
                    messages: [{
                        role: 'user',
                        content: `请为以下产品生成 PRD 章节：${chapter.title || ''}\n要求：${chapter.brief || ''}\n产品：${JSON.stringify(body.product || {}, null, 2)}`,
                    }],
                });
                sendJson(res, 200, { text });
                return;
            }

            if (endpoint === 'slides') {
                sendJson(res, 200, {
                    title: 'AI 产品提案',
                    subtitle: '由当前站点生成',
                    slides: [
                        { title: '方案概览', bullets: ['请基于正文进一步整理演示重点。'] },
                    ],
                });
                return;
            }

            sendJson(res, 404, { error: `未知 LLM API: ${endpoint}` });
            return;
        }

        if (req.method === 'POST' && requestUrl.pathname === '/api/chat') {
            const body = await getRequestBody(req);
            const messages = Array.isArray(body.messages) ? body.messages : [];

            if (!messages.length) {
                sendJson(res, 400, { error: 'messages 不能为空' });
                return;
            }

            try {
                const reply = await callCoze(messages);
                sendJson(res, 200, { reply, source: 'coze' });
                return;
            } catch (cozeError) {
                console.warn('[resume coze fallback]', cozeError.message);

                try {
                    const reply = await callOpenAiCompatibleLlm(
                        {
                            messages,
                            temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.4,
                            max_tokens: Number(body.max_tokens || body.maxTokens || 1800),
                        },
                        {
                            system: buildResumeFallbackSystemPrompt(),
                        }
                    );

                    sendJson(res, 200, {
                        reply,
                        source: 'builtin-app-llm-fallback',
                        primaryError: cozeError.message,
                    });
                    return;
                } catch (fallbackError) {
                    throw new Error(
                        `简历问答失败：Coze 调用失败(${cozeError.message})，内置兜底也失败(${fallbackError.message})`
                    );
                }

            }
        }

        if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Method Not Allowed');
            return;
        }

        const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
        const filePath = safeJoin(ROOT_DIR, pathname);

        if (!filePath.startsWith(ROOT_DIR)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Forbidden');
            return;
        }

        sendFile(res, filePath);
    } catch (error) {
        console.error('[server error]', error);
        sendJson(res, 500, {
            error: error.message || '服务异常',
        });
    }
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(
            `端口 ${CONFIG.port} 已被占用，请修改 .env 里的 PORT，或先关闭占用该端口的进程。`
        );
        return;
    }

    console.error('[listen error]', error);
});

server.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`Resume site running at http://${CONFIG.host}:${CONFIG.port}`);
    console.log('Resume AI chat endpoint: POST /api/chat');
    console.log('App LLM endpoints: POST /llm-api/*');
});
