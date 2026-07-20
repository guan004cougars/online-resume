# HTML 报告规范

当用户希望本地预览、汇报展示或沉淀正式材料时，优先输出 HTML 报告。

## 一、目标

HTML 报告不应只是把纯文本包进网页，而应让竞品分析更适合浏览、比较和汇报。

## 二、推荐页面结构

建议包含这些区块：

1. 顶部摘要
- 标题
- 分析日期
- 分析目标
- 一句话结论

2. 关键结论卡片
- 市场结论
- 主要机会点
- 主要风险
- 建议动作

3. 目标市场
- 目标市场定义
- 市场成立原因
- 核心需求
- 行业规模
- 行业增速

4. 用户画像
- 1-4 个关键用户画像
- 为什么会用
- 核心需求和决策权重

5. 市场关键竞争要素
- 用卡片或标签展示 3-5 个核心竞争要素
- 对每个要素做一句解释

6. 市场竞争格局
- 二维四象限散点图
- 市场份额饼图
- 市场类型判断
- 头部、中部、长尾分层
- 直接竞品与替代方案说明
- 市场空位或竞争趋势总结

四象限补充规则：
- x 轴和 y 轴都应来自“市场关键竞争要素”
- 页面上最好明确标出这两个轴分别对应了哪些竞争要素
- 如果竞争要素有多个，要补一句“为什么这次选这两个”

7. 核心竞品卡片
- 每个竞品一个卡片
- 包含定位、目标用户、核心场景、解决痛点、是否刚需、核心壁垒、业务逻辑、商业模式、盈利模式、收入结构、获客、留存、转化、企业/产品关键路径和关键数据
- 企业/产品关键路径不要只展示年份节点，优先展示“阶段主题 + 决策逻辑 + 影响 + 下一步推演”

8. 横向比较矩阵
- 对比表
- 强弱标记
- 差异总结

9. 行业发展路径
- 行业关键政策
- 行业需求变化
- 行业竞争方式变化

说明：
- 报告级别写“行业发展路径”
- 单个竞品卡片里写“企业/产品关键路径”
- 不要把行业变化和单个企业路径混在一起

10. 机会点与建议
- 机会点卡片
- 不建议照搬项
- 优先级建议

11. 数据来源
- 来源列表
- 口径和时间标注

## 三、展示原则

- 结论先行
- 一屏可看到重点
- 表格只承载对比，不承载所有说明
- 用卡片表达摘要，用时间轴表达行业或企业路径，用表格表达横向差异
- 市场竞争格局优先用“坐标轴 + 点”的二维散点图，以及饼图/分层图承载
- 如果是企业服务或平台型业务，竞品卡片要额外解释购买方、使用方、交付方式，以及获客到续费的业务链路
- 核心壁垒、盈利模式和收入结构最好彼此关联，不要孤立描述
- 数据一定标时间和来源

## 四、图表与模块建议

适合图表的内容：
- 市场分层
- 数据趋势
- 竞争要素分布
- 二维四象限定位
- 市场份额分布
- 玩家层级结构
- 坐标轴散点图
- 饼图

适合卡片的内容：
- 结论
- 用户画像
- 竞品摘要
- 机会点
- 壁垒与商业模式摘要

适合表格的内容：
- 核心指标对比
- 功能与能力对比

适合时间轴的内容：
- 行业发展路径
- 企业发展路径
- 产品关键迭代

适合阶段卡片的内容：
- 企业/产品关键路径
- 每个阶段的决策逻辑
- 每个阶段对产品形态和商业模式的影响

## 五、最小字段建议

如果要生成 HTML，结构化数据中尽量包含：
- title
- generated_at
- goal
- summary
- target_market
- user_personas
- competition_factors
- market_landscape
- competitors
- industry_timeline
- insights
- recommendations
- sources

如果要更好承载市场竞争格局，建议补这些字段：
- market_landscape.summary
- market_landscape.quadrant.x_axis
- market_landscape.quadrant.y_axis
- market_landscape.quadrant.axis_source_factors[]
- market_landscape.quadrant.axis_selection_reason
- market_landscape.quadrant.items[]
- market_landscape.quadrant.items[].name
- market_landscape.quadrant.items[].type
- market_landscape.quadrant.items[].quadrant
- market_landscape.quadrant.items[].x
- market_landscape.quadrant.items[].y
- market_landscape.quadrant.items[].color
- market_landscape.quadrant.items[].size
- market_landscape.quadrant.items[].description
- market_landscape.market_share_distribution
- market_landscape.market_share_distribution[].tier
- market_landscape.market_share_distribution[].players
- market_landscape.market_share_distribution[].share_percent
- market_landscape.market_share_distribution[].color
- market_landscape.market_share_distribution[].share_or_scale
- market_landscape.market_share_distribution[].description
- market_landscape.market_structure_type
- market_landscape.market_structure_assessment
- market_landscape.market_layers[]
- market_landscape.gaps[]
- market_landscape.trends[]

如果要更好承载核心壁垒、盈利模式和收入结构，建议补这些字段：
- target_market.key_pain_points[]
- target_market.hard_need_assessment
- target_market.market_size
- target_market.market_growth
- competitors[].pain_point_solved
- competitors[].hard_need_assessment
- competitors[].moat_summary
- competitors[].moat_sources[]
- competitors[].why_it_can_win
- competitors[].business_model
- competitors[].profit_model
- competitors[].growth_flywheel
- competitors[].model_type
- competitors[].ceiling_risk
- competitors[].revenue_structure_summary
- competitors[].revenue_streams[]
- competitors[].revenue_streams[].name
- competitors[].revenue_streams[].share
- competitors[].revenue_streams[].amount
- competitors[].revenue_streams[].description
- competitors[].revenue_streams[].strategic_focus
- competitors[].revenue_streams[].competitors

如果要更好承载企业/产品关键路径，建议补这些字段：
- competitors[].company_role_in_business
- competitors[].company_product_path.overall_judgment
- competitors[].company_product_path.stages[]
- competitors[].company_product_path.stages[].stage
- competitors[].company_product_path.stages[].period
- competitors[].company_product_path.stages[].strategy_theme
- competitors[].company_product_path.stages[].what_happened
- competitors[].company_product_path.stages[].decision_logic
- competitors[].company_product_path.stages[].why_now
- competitors[].company_product_path.stages[].impact_on_product
- competitors[].company_product_path.stages[].business_signal
- competitors[].company_product_path.stages[].next_inference

## 六、实践建议

如果只是一次性分析，可先写结构化文本再转 HTML。
如果需要反复产出，建议先整理成结构化 JSON，再用脚本渲染 HTML。

可直接参考：
- 输入模板：[assets/report-input-template.json](../assets/report-input-template.json)
- 示例数据：[assets/sample-ai-notes-analysis.json](../assets/sample-ai-notes-analysis.json)
- 渲染脚本：[scripts/render_html_report.py](../scripts/render_html_report.py)
