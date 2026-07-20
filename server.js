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
    host: process.env.HOST || '0.0.0.0',
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

const WORK_EXPERIENCE_BLOCK = `
【工作经历】
1. 上海理想信息产业有限公司（中国电信子公司），AI产品经理，2024.09 - 至今
- 负责面向大中型B端、G端客户的AI应用规划与落地，覆盖智能客服、医疗、教育等场景。
- 主导上海电信智能客服、中医大模型、智能教学平台等项目的需求拆解、方案设计、Prompt/知识库策略和评测闭环建设。
- 推动AI渠道独立承接近50%套餐咨询流量，套餐订购率达30.7%；医生病历修改时间降低约80%，诊疗效率提升30%以上；AI出题准确率达96.7%，教案和课件可直接使用率达80%以上。

2. 上海脑医汇科技有限公司，产品经理，2023.04 - 2024.07
- 负责医疗业务相关产品规划，覆盖AIGC智能问答、临床招募平台、慢病管理平台与企业CRM系统。
- 作为智能问答系统产品负责人，完成模型对比、医学知识库、RAG与Prompt方案设计，兼顾医疗场景准确性、专业性、合规性和成本约束。
- 产品上线两周内使用人数约1.6万人，二次使用及以上用户占比60%以上，单用户单次平均对话4.3条；临床招募平台稳定后3个月内营收超过60万元，外部引流患者5千人以上，后期月营收约30万元。

3. 上海佳一健康管理有限公司，产品经理，2021.10 - 2023.02
- 负责医疗服务相关产品规划，覆盖AI智能客服、院外康复管理平台等项目。
- 基于治疗指南、患教资料等企业医疗资源建设知识库，结合数据特征提取和相似内容检索实现患者常见问题自动回复。
- 参与院外康复管理平台规划，覆盖在线诊疗、用药管理、康复训练、康复评估、挂号加号、病历数据管理等场景，累计服务患者10万以上，沉淀病历数据30万份以上。

4. 上海世外智慧教育有限公司（均瑶集团），产品经理，2020.10 - 2021.09
- 负责英语启蒙产品和口语学习产品规划与设计，积累教育场景产品经验。

5. 上海信书信息科技有限公司，产品经理，2019.11 - 2020.07
- 负责相册制作产品优化迭代、人脸识别应用及裂变分销系统相关工作。
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

const SELF_INTRO_SYSTEM_PROMPT = `
当用户要求“自我介绍”或“介绍一下你自己/管开祥”时，请以管开祥本人的第一人称进行回答。
只允许基于下面提供的个人背景、工作经历与6个项目知识组织内容，不要编造不存在的公司、项目、数据、技术栈或职责。
回答建议控制在150-260字，突出AI产品经理定位、近年AI落地经验、代表项目、核心能力和适配岗位；不要机械罗列所有信息。
如果用户明确要求更短或更正式，请按用户要求调整长度与语气。
`.trim();

const PROJECT_DETAIL_SYSTEM_PROMPT = `
当用户明确追问某个具体项目时，请优先基于该项目的详细资料回答，而不是泛泛复述整份简历。
回答要求：
1. 严格基于提供资料，不编造未出现的项目细节、数据定义、技术选型或结果。
2. 优先回答用户真正关心的点，如背景、痛点、方案、流程、模型选型、RAG、Prompt、评测、反馈闭环、指标定义、优化思路等。
3. 如果用户问到的数据在资料中只有口径没有完整定义，要明确说明“当前资料里可确认的是……”，不要补造。
4. 输出保持分段、清晰、有条理，必要时使用编号。
`.trim();

const PROJECT_DETAIL_KNOWLEDGE = {
    telecom: `
【项目深度资料：上海电信智能客服项目】
- 服务对象：中国电信股份有限公司上海分公司。
- 项目背景与目标：基于上海电信客服需求，提高服务效率，用 AI 替代部分人工服务；重点解决客服人员流动大、培训成本高、用户等待时间长、难以快速匹配合适套餐等问题。
- 覆盖场景：套餐咨询、套餐推荐、办理进度查询、售后服务。
- 技术方案：Prompt + 知识库（套餐信息、权益解释、活动信息、售后处理方案等）+ 函数调用 + ask human help + 多模态模型组合（Qwen3-30B-A3B / Qwen3-8B-VL）。
- 多轮对话处理：保留最近10轮对话 + 关键轮次；关键轮包括新意图、关键信息提供、Agent关键操作。每10轮异步生成一次结构化摘要缓存，注入“对话摘要 + 最近10轮对话”，降低上下文膨胀。
- 业务流程：登录校验 -> 意图识别 -> 消息澄清 -> 提取套餐需求 -> 查询套餐 -> 套餐排序（优先主推） -> 跳转办理链接 -> 用户可换一批或继续其他意图。
- 模型与RAG：本地化部署在天翼云；场景以中短推理和工具调用为主。RAG 内容包括套餐、权益、活动、售后、标准回复话术；知识处理以问答对向量化为主，提高检索准确率。
- 工具与能力：套餐查询接口；非标准化诉求处理能力，如价格敏感型补赠权益、流失用户追问原因与转人工等。
- 核心指标：推荐准确率 98%+、意图识别准确率 92%+、套餐订购率 30.7%、AI 渠道承接近 50% 套餐咨询流量。
- 指标口径补充：资料中明确区分“推荐准确率”和“首推命中率”。推荐准确率更偏条件命中，即推荐结果满足用户表达的筛选条件并覆盖主推套餐；首推命中率约 62%，是更接近业务转化的深层指标。
- 反馈闭环：通过“换一批”、反馈按钮、转人工收集 bad case；将推荐不准、回答不准、非标准化诉求等问题分类，优化 Prompt、知识库和策略。
- 典型优化点：围绕价格敏感、隐性需求、用户流失等问题做赠品策略、用户画像补全、追问节点设计，提升订购率。
`.trim(),
    teaching: `
【项目深度资料：智能教学平台（浙江财经大学）】
- 服务对象：浙江财经大学。
- 项目背景与目标：构建智能教学平台，提高教师教学效率和学生学习效果；缓解教师备课、答疑、批改耗时高，以及学生个性化学习内容不足的问题。
- 覆盖场景：教师端覆盖 AI 出题、AI 教案、AI 课件、批改、学情分析；学生端覆盖个性化习题与资料查询。
- 技术方案：Prompt + 教学大模型（Qwen-2.5 72B / 32B）+ 题库/教材/教案/课件知识库 + PPT 生成插件 + 反馈闭环；出题环节结合 Qwen-Math 做检查。
- 业务流程：
  1. AI出题：选择知识点/难度/题量 -> 检索题库参考 -> 生成3道题 -> Math模型检查 -> 呈现 -> 用户加入/重生成/反馈错误。
  2. AI教案：选择章节知识点 -> 生成大纲与内容 -> 在线调整与下载。
  3. AI课件：选择章节知识点 -> 生成课件大纲与内容 -> 调整 -> 调用 PPT 工具生成课件。
- 模型与RAG：内容生成主用 Qwen72B；校验主用 Qwen-Math。RAG 包含题目、教材、教案、课件等；题目做结构化字段处理，教案/教材/课件采用父子级切片。
- 工具与Skill：PPT 生成工具；教案撰写、课件撰写等能力可模块化复用。
- 核心结果：AI 出题准确率 95%+；AI 教案基本可直接使用，平均修改比例不超过 20%；AI 课件大纲和内容基本符合教师要求，PPT 需要少量人工调整。
- 指标口径：出题准确率会细分为知识点匹配、难度匹配、内容结构正确率、题目与解析准确率；教案看内容准确率、结构完整率、内容评分；课件看结构准确率与内容准确率。
- 反馈闭环：记录在线修改、重新生成、反馈、保存下载等行为；把 bad case 和高质量修改内容回流，用于 Prompt、案例库与知识库持续优化。
- 典型挑战：不同教师风格差异大，一套提示词难覆盖所有人；通过可维护提示词与版本管理能力提高适配性。
`.trim(),
    tcm: `
【项目深度资料：中医大模型项目（龙华医院）】
- 服务对象：上海中医药大学附属龙华医院。
- 项目背景与目标：围绕病历质控与中医临床辅助决策，提高医生效率与输出一致性；解决病历质控人工抽检覆盖低、标准不一，以及临床诊断依赖个人经验的问题。
- 覆盖场景：病历质控、中医外科辅助决策、方剂/中药/指南知识查询。
- 技术方案：本地化部署开源模型；核心使用微调后的方证大模型（基于 Qwen3-8B）+ 知识库 + Prompt。临床决策按“病-证-症-方-药”链路输出；病历质控按《病历规范》21条规则审查。
- 业务流程：
  1. 临床决策：输入解析 -> 检索指南/方剂知识 -> 辨证论治推理 -> 安全与合规约束 -> 结构化输出 -> 医生反馈。
  2. 病历质控：上传病历 -> 模型按条例和 few-shot 找问题 -> 查询相似问题案例与修改建议 -> 给出修改内容 -> 在线反馈。
- RAG 内容：方剂知识库、中药知识库、中医临床各科指南、古代膏方、海派膏方、ICD10 等。
- 知识处理：方剂按作者、来源、朝代、方剂名、主治、组成、用法结构化；指南按病名、证型、主症、兼症与舌脉、治法、例方结构化；病历质控建议按“依据 + 问题病历 + 修改建议”构造成问答对，并按病种拆分。
- Prompt 约束重点：知识边界受限、必须引用知识库依据、症状信息不足时要请求补充、输出结构化 JSON，并显式做禁忌与安全提醒。
- 核心结果：病历质控准确率 92.4%；问答准确率约 86%；医生病历修改时间降低约 80%，诊疗效率提升 30%+。
- 指标口径：质控准确率关注是否找出问题病历、给出合理依据和正确修改建议；问答准确率关注病名、证型、症状、治法、方剂用量、禁忌等输出准确率。
- 反馈闭环：收集“准确/不准确”反馈，并细分为输出不足、内容错误、症状识别错误、方剂错误、病名不准、剂量超标等；结合 bad case、真实采样和对抗案例持续回归。
- 典型挑战：患者口语化描述向中医症状标准化映射困难；方剂剂量个体差异大。优化方向包括症状标准化模型、口语-症状映射库、多轮澄清与知识库剂量反馈更新。
`.trim(),
    court: `
【项目深度资料：无锡检察院智能办案平台】
- 服务对象：无锡检察院相关业务部门。
- 项目背景与目标：围绕办案与办公场景提升效率和准确率，减少人工查阅大量文件、提取关键信息、比对文书、撰写固定结构内容的时间成本。
- 覆盖场景：类案发现、量刑建议、文书撰写、三书比对、审查报告生成。
- 技术方案：文件解析 + Prompt + 案件/法律法规知识库 + 本地化 Qwen-32B；不同场景组合使用案件查询、结构化抽取与内容生成能力。
- 业务流程：
  1. 类案发现：输入罪名/案件过程/判罚或上传案件 -> 文件解析 -> 查询并推送相似案件。
  2. 审查报告：上传案件文件 -> 文件解析 -> 基于 Prompt 和知识库生成报告。
  3. 三书比对：上传起诉书/判决书/意见书 -> 提取关键字段 -> 结构化展示 -> 比对差异。
  4. 量刑建议：解析关键情节 -> 检索同罪名/近似金额案例 -> 总结量刑区间与影响情节。
- 模型与RAG：受限于 2 张 4090 的本地算力，选用 Qwen-32B。RAG 包括法律法规、判决书、案件数据；法律法规按法律名称/章/条切分，判决书与案件信息做结构化分段与父子级切片。
- 关键知识处理：用规则解析器拆分“经审理查明”“本院认为”“判决结果”等字段；字段名归一化后再向量化，并按查询意图加字段过滤，提升法条与案件召回质量。
- 核心结果：内容准确率约 95%；提取信息准确率 98%+；模型生成可用率 95%+；法条引用准确率从 71% 提升到约 89%。
- 指标口径：关注内容结构正确、信息提取准确、法条引用准确、生成可用率；辅助指标包括提取准确率与法条引用准确率。
- 反馈闭环：通过反馈按钮和在线修改收集 bad case，重点抓取修改幅度超过 20% 的内容；从切片问题、Prompt 约束不足、幻觉、知识缺失等角度归因。
- 典型挑战：文书格式差异大、算力受限、相似案件检索不准。解决方法包括字段级结构化索引、规则解析 + LLM 兜底、父子级切片与字段过滤检索。
`.trim(),
    hsbc: `
【项目深度资料：汇丰银行智能监管平台】
- 服务对象：汇丰银行监管/合规部门。
- 项目背景与目标：把外部监管规则更高效地转化为内部可执行的合规要求，并提升监管报告、新闻稿及相关内容产出的效率与可控性。
- 覆盖场景：外规内化、监管报告撰写、新闻稿/对外稿件撰写、企业级知识问答。
- 技术方案：Prompt + 企业知识库 + 文件解析 + 行内模型。外规内化场景中先解析外部监管文件，再抽取义务点，随后检索与匹配内部制度，最后输出缺失、冲突、部分匹配、完全匹配结果。
- 业务流程：
  1. 外规内化：上传监管文件 -> 文件解析 -> 条款/义务点抽取 -> 检索内规 -> 内外规匹配 -> 结构化展示结果。
  2. 报告/新闻稿：上传政策文件、监管文件或相关新闻 -> 结合知识库生成初稿 -> 用户在线修改 -> 反馈沉淀为优化数据。
- RAG 与数据处理：重点不是自然段切分，而是按章节、条款、义务点切分；内部制度同样做细粒度结构化，便于后续匹配和引用追溯。
- Prompt 重点：先抽取再判断，避免一步到位自由生成；强约束结构化输出；无依据不输出；生成结果需带引用来源。
- 可复用能力模块：义务点抽取、匹配关系判断、报告初稿生成。
- 核心结果：企业级知识问答准确率 87.1%；引用准确率 89.4%；监管报告可用率 78.5%；新闻稿/类似稿件可用率 83.4%。
- 指标口径：重点看问答准确率、引用准确率、报告可用率、稿件可用率；因为金融合规场景既要求答对，也要求引得准、最终能用。
- 反馈闭环：以用户在线修改为核心反馈入口，围绕义务点抽取错误、匹配错误、引用错误、幻觉、可用性不足等维度标注；将修改量大、审核退回和 bad case 持续沉淀进回归集。
- 典型挑战：准确性要求极高，且客户业务口径会变；解决方法是把任务拆成更稳定的节点，并把义务点识别等关键规则做成可维护、可配置的逻辑。
`.trim(),
    brain: `
【项目深度资料：医疗AIGC智能问答系统（脑医汇）】
- 服务对象：脑科学相关医疗业务场景。
- 项目背景与目标：在兼顾专业性、准确性、合规性和成本约束的前提下，落地脑科学领域智能问答能力，满足病例和资料查询、文章初稿生成等需求。
- 技术方案：基于医学知识库 + RAG + Prompt 设计完成智能问答方案，并结合多模型对比完成模型选型。
- 工作重点：综合业务场景、模型效果、合规要求和成本做方案选择；建立结果评估与用户反馈闭环。
- 核心结果：上线两周内使用人数约 1.6 万；二次使用及以上用户占比 60%+；单用户单次平均对话 4.3 条。
- 说明：当前项目详细资料主要来自现有简历内容，若后续补充更完整项目文档，可继续增强这一块知识深度。
`.trim(),
};

const PROJECT_DETAIL_MATCHERS = [
    {
        key: 'telecom',
        pattern: /上海电信|中国电信|电信项目|电信客服|智能客服|套餐咨询|套餐推荐|办理进度|售后服务|晶晶/,
    },
    {
        key: 'tcm',
        pattern: /中医大模型|龙华医院|上海中医药大学附属龙华医院|病历质控|临床辅助决策|中医临床|辨证|方剂|膏方/,
    },
    {
        key: 'teaching',
        pattern: /浙江财经|浙江财经大学|智能教学平台|教学平台|AI出题|AI教案|AI课件|自动批改|个性化练习/,
    },
    {
        key: 'court',
        pattern: /无锡检察院|检察院|智能办案|类案发现|三书比对|审查报告|量刑建议|起诉书|判决书/,
    },
    {
        key: 'hsbc',
        pattern: /汇丰|汇丰银行|外规内化|监管报告|合规义务点|内外规|新闻稿|监管文件/,
    },
    {
        key: 'brain',
        pattern: /脑医汇|医疗AIGC智能问答|AIGC智能问答|脑科学|智能问答系统/,
    },
];

function buildResumeFallbackSystemPrompt() {
    return `${RESUME_FALLBACK_SYSTEM_PROMPT}\n\n${RESUME_PROFILE_BLOCK}\n\n${WORK_EXPERIENCE_BLOCK}\n\n${PROJECT_KNOWLEDGE_BLOCK}`;
}

function getLastUserMessage(messages) {
    if (!Array.isArray(messages)) return null;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role === 'user' && typeof message.content === 'string') {
            return message;
        }
    }

    return null;
}

function isSelfIntroRequest(messages) {
    const lastUserMessage = getLastUserMessage(messages);
    const content = lastUserMessage?.content?.trim() || '';
    if (!content) return false;

    return /自我介绍|介绍一下(?:你自己|自己|管开祥)|介绍下(?:你自己|自己|管开祥)|你是谁|个人介绍|做个介绍|简单介绍/.test(content);
}

function detectProjectIntentFromText(text) {
    const value = String(text || '').trim();
    if (!value) return [];

    return PROJECT_DETAIL_MATCHERS
        .filter((matcher) => matcher.pattern.test(value))
        .map((matcher) => matcher.key);
}

function detectProjectIntent(messages) {
    const lastUserMessage = getLastUserMessage(messages);
    return detectProjectIntentFromText(lastUserMessage?.content || '');
}

function buildResumeSelfIntroSystemPrompt() {
    return [
        RESUME_FALLBACK_SYSTEM_PROMPT,
        SELF_INTRO_SYSTEM_PROMPT,
        RESUME_PROFILE_BLOCK,
        WORK_EXPERIENCE_BLOCK,
        PROJECT_KNOWLEDGE_BLOCK,
    ].join('\n\n');
}

function buildResumeProjectDetailSystemPrompt(projectKeys) {
    const detailBlocks = (Array.isArray(projectKeys) ? projectKeys : [])
        .map((key) => PROJECT_DETAIL_KNOWLEDGE[key])
        .filter(Boolean);

    if (!detailBlocks.length) {
        return buildResumeFallbackSystemPrompt();
    }

    return [
        buildResumeFallbackSystemPrompt(),
        PROJECT_DETAIL_SYSTEM_PROMPT,
        ...detailBlocks,
    ].join('\n\n');
}

function buildResumeChatSystemPrompt(messages) {
    if (isSelfIntroRequest(messages)) {
        return buildResumeSelfIntroSystemPrompt();
    }

    const matchedProjectKeys = detectProjectIntent(messages);
    if (matchedProjectKeys.length) {
        return buildResumeProjectDetailSystemPrompt(matchedProjectKeys);
    }

    return buildResumeFallbackSystemPrompt();
}

function buildResumeCozeMessages(messages) {
    if (isSelfIntroRequest(messages)) {
        return mergeSystemIntoMessages(buildResumeSelfIntroSystemPrompt(), messages);
    }

    const matchedProjectKeys = detectProjectIntent(messages);
    if (matchedProjectKeys.length) {
        return mergeSystemIntoMessages(buildResumeProjectDetailSystemPrompt(matchedProjectKeys), messages);
    }

    return messages;
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
        throw new Error('应用模型配置不完整。请检查内置配置或环境变量 APP_LLM_BASE_URL、APP_LLM_API_KEY、APP_LLM_MODEL。');
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

            const systemPrompt = buildResumeChatSystemPrompt(messages);
            const reply = await callOpenAiCompatibleLlm(
                {
                    messages,
                    temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.4,
                    max_tokens: Number(body.max_tokens || body.maxTokens || 1800),
                },
                {
                    system: systemPrompt,
                }
            );

            sendJson(res, 200, {
                reply,
                source: 'builtin-app-llm',
            });
            return;
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
