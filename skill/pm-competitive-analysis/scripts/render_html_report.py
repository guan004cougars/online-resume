#!/usr/bin/env python3
"""
将结构化 JSON 竞品分析数据渲染为本地可预览的 HTML 报告。

用法：
    python render_html_report.py input.json output.html
"""

from __future__ import annotations

import html
import json
import sys
from datetime import datetime
from pathlib import Path

PALETTE = [
    "#4f86c6",
    "#e07a5f",
    "#7bb661",
    "#9d79bc",
    "#e9c46a",
    "#3aa6b9",
]


def esc(value: object) -> str:
    return html.escape("" if value is None else str(value))


def as_float(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("%", "").replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def render_tags(items: list[str]) -> str:
    if not items:
        return "<p class='muted'>暂无</p>"
    return "".join(f"<span class='tag'>{esc(item)}</span>" for item in items)


def render_list(items: list[str]) -> str:
    if not items:
        return "<p class='muted'>暂无</p>"
    return "<ul>" + "".join(f"<li>{esc(item)}</li>" for item in items) + "</ul>"


def render_personas(personas: list[dict]) -> str:
    if not personas:
        return "<p class='muted'>暂无用户画像。</p>"
    cards = []
    for item in personas:
        needs = render_list(item.get("core_needs", []))
        cards.append(
            f"""
            <div class="card persona-card">
              <h3>{esc(item.get("name", "未命名画像"))}</h3>
              <p><strong>角色：</strong>{esc(item.get("role", "-"))}</p>
              <p><strong>为什么会用：</strong>{esc(item.get("why_use", "-"))}</p>
              <div><strong>核心诉求：</strong>{needs}</div>
              <p><strong>决策权重：</strong>{esc(item.get("decision_weight", "-"))}</p>
            </div>
            """
        )
    return "<div class='summary-grid'>" + "".join(cards) + "</div>"


def render_market(market: dict) -> str:
    if not market:
        return "<p class='muted'>暂无目标市场定义。</p>"
    pain_points = render_list(market.get("key_pain_points", []))
    needs = render_list(market.get("core_needs", []))
    return f"""
    <div class="card">
      <p><strong>目标市场定义：</strong>{esc(market.get("market_definition", "-"))}</p>
      <p><strong>市场成立原因：</strong>{esc(market.get("why_this_market_exists", "-"))}</p>
      <div><strong>关键痛点：</strong>{pain_points}</div>
      <p><strong>刚需判断：</strong>{esc(market.get("hard_need_assessment", "-"))}</p>
      <p><strong>行业规模：</strong>{esc(market.get("market_size", "-"))}</p>
      <p><strong>行业增速：</strong>{esc(market.get("market_growth", "-"))}</p>
      <div><strong>核心需求：</strong>{needs}</div>
    </div>
    """


def render_key_metrics(metrics: list[dict] | list[str]) -> str:
    if not metrics:
        return "<p class='muted'>暂无关键数据。</p>"
    if metrics and isinstance(metrics[0], str):
        return render_list(metrics)
    rows = []
    for item in metrics:
        rows.append(
            "<tr>"
            f"<td>{esc(item.get('name', '-'))}</td>"
            f"<td>{esc(item.get('value', '-'))}</td>"
            f"<td>{esc(item.get('note', '-'))}</td>"
            "</tr>"
        )
    return (
        "<table><thead><tr><th>指标</th><th>值</th><th>说明</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table>"
    )


def render_market_landscape(landscape: dict) -> str:
    if not landscape:
        return "<p class='muted'>暂无市场竞争格局。</p>"

    quadrant = landscape.get("quadrant", {})
    items = quadrant.get("items", [])
    quadrant_centers = {
        "左上": (28.0, 72.0),
        "右上": (72.0, 72.0),
        "左下": (28.0, 28.0),
        "右下": (72.0, 28.0),
    }
    quadrant_offsets = {
        "左上": [(-12, 10), (10, -6), (-2, -16), (16, 14)],
        "右上": [(-10, 8), (12, -4), (-4, -16), (18, 12)],
        "左下": [(-12, 8), (10, -8), (-4, -16), (16, 12)],
        "右下": [(-10, 10), (12, -6), (-6, -18), (18, 10)],
    }

    quadrant_counts = {"左上": 0, "右上": 0, "左下": 0, "右下": 0}
    scatter_points = []
    for index, item in enumerate(items):
        bucket = item.get("quadrant", "")
        color = item.get("color") or PALETTE[index % len(PALETTE)]
        x_value = as_float(item.get("x"))
        y_value = as_float(item.get("y"))
        if x_value is None or y_value is None:
            center_x, center_y = quadrant_centers.get(bucket, (50.0, 50.0))
            bucket_index = quadrant_counts.get(bucket, 0)
            offsets = quadrant_offsets.get(bucket, [(0, 0)])
            offset_x, offset_y = offsets[bucket_index % len(offsets)]
            x_value = center_x + offset_x
            y_value = center_y + offset_y
            quadrant_counts[bucket] = bucket_index + 1
        point_size = as_float(item.get("size")) or 18.0
        scatter_points.append(
            {
                "name": item.get("name", "-"),
                "type": item.get("type", "-"),
                "description": item.get("description", "-"),
                "color": color,
                "x": max(4.0, min(96.0, x_value)),
                "y": max(4.0, min(96.0, y_value)),
                "size": max(12.0, min(28.0, point_size)),
            }
        )

    point_markup = []
    detail_markup = []
    for point in scatter_points:
        point_markup.append(
            f"""
            <div class="scatter-point" style="left: calc({point['x']:.2f}% - {point['size'] / 2:.1f}px); top: calc({100 - point['y']:.2f}% - {point['size'] / 2:.1f}px); width: {point['size']:.1f}px; height: {point['size']:.1f}px; background: {point['color']};">
              <span>{esc(point['name'])}</span>
            </div>
            """
        )
        detail_markup.append(
            f"""
            <div class="landscape-item">
              <p><strong><span class="swatch" style="background:{point['color']};"></span>{esc(point['name'])}</strong></p>
              <p class="muted">{esc(point['type'])}</p>
              <p>{esc(point['description'])}</p>
            </div>
            """
        )

    share_items = landscape.get("market_share_distribution", [])
    share_values = []
    for item in share_items:
        share_value = as_float(item.get("share_percent"))
        if share_value is not None and share_value > 0:
            share_values.append(share_value)
    share_total = sum(share_values)

    pie_segments = []
    share_legend = []
    start = 0.0
    share_rows = []
    valid_share_found = share_total > 0
    for index, item in enumerate(share_items):
        color = item.get("color") or PALETTE[index % len(PALETTE)]
        share_value = as_float(item.get("share_percent"))
        if share_value is not None and share_value > 0 and share_total > 0:
            normalized_share = share_value / share_total * 100.0
            pie_segments.append(
                f"{color} {start:.2f}% {start + normalized_share:.2f}%"
            )
            share_legend.append(
                f"""
                <div class="pie-legend-item">
                  <span class="swatch" style="background:{color};"></span>
                  <span>{esc(item.get("tier", "-"))} {esc(item.get("share_percent", "-"))}%</span>
                </div>
                """
            )
            start += normalized_share
        share_rows.append(
            "<tr>"
            f"<td>{esc(item.get('tier', '-'))}</td>"
            f"<td>{esc(item.get('players', '-'))}</td>"
            f"<td>{esc(item.get('share_percent', item.get('share_or_scale', '-')))}</td>"
            f"<td>{esc(item.get('description', '-'))}</td>"
            "</tr>"
        )

    share_table = (
        "<table><thead><tr><th>层级</th><th>主要玩家</th><th>份额/规模</th><th>说明</th></tr></thead>"
        f"<tbody>{''.join(share_rows)}</tbody></table>"
        if share_rows
        else "<p class='muted'>暂无市场份额或分层数据。</p>"
    )
    pie_chart = (
        f"""
        <div class="pie-chart-panel">
          <div class="pie-chart" style="background: conic-gradient({', '.join(pie_segments)});"></div>
          <div class="pie-legend">{''.join(share_legend)}</div>
        </div>
        """
        if valid_share_found
        else "<p class='muted'>暂无可绘制的市场份额占比，当前仅展示分层说明。</p>"
    )
    structure_type = esc(landscape.get("market_structure_type", "-"))
    structure_assessment = esc(landscape.get("market_structure_assessment", "-"))
    structure_note = f"""
    <div class="market-structure-note">
      <p><strong>市场类型判断：</strong>{structure_type}</p>
      <p><strong>定性解析：</strong>{structure_assessment}</p>
    </div>
    """

    layer_cards = "".join(
        f"<div class='factor-card'><h4>{esc(item.get('name', '-'))}</h4><p>{esc(item.get('description', '-'))}</p></div>"
        for item in landscape.get("market_layers", [])
    )
    if not layer_cards:
        layer_cards = "<p class='muted'>暂无玩家分层说明。</p>"

    gaps = render_list(landscape.get("gaps", []))
    trends = render_list(landscape.get("trends", []))

    return f"""
    <div class="card">
      <p><strong>格局判断：</strong>{esc(landscape.get("summary", "-"))}</p>
    </div>
    <div class="landscape-wrap">
      <div class="card">
        <h3>{esc(quadrant.get("title", "二维四象限定位"))}</h3>
        <div class="axis-copy">
          <p><strong>X 轴：</strong>{esc(quadrant.get("x_axis", "-"))}</p>
          <p><strong>Y 轴：</strong>{esc(quadrant.get("y_axis", "-"))}</p>
          <p><strong>轴来源竞争要素：</strong>{esc(" / ".join(quadrant.get("axis_source_factors", [])) or "-")}</p>
          <p><strong>为什么选这两个轴：</strong>{esc(quadrant.get("axis_selection_reason", "-"))}</p>
        </div>
        <div class="scatter-layout">
          <div class="scatter-panel">
            <div class="scatter-plot">
              <div class="scatter-axis scatter-axis-x"></div>
              <div class="scatter-axis scatter-axis-y"></div>
              <div class="scatter-corner scatter-corner-lt">左上</div>
              <div class="scatter-corner scatter-corner-rt">右上</div>
              <div class="scatter-corner scatter-corner-lb">左下</div>
              <div class="scatter-corner scatter-corner-rb">右下</div>
              {''.join(point_markup)}
            </div>
          </div>
          <div class="scatter-detail">
            {''.join(detail_markup) if detail_markup else "<p class='muted'>暂无点位说明。</p>"}
          </div>
        </div>
      </div>
      <div class="summary-grid">
        <div class="card">
          <h3>市场份额分布</h3>
          {pie_chart}
        </div>
        <div class="card">
          <h3>市场份额说明</h3>
          {share_table}
          {structure_note}
        </div>
      </div>
      <div class="card">
        <h3>玩家层级</h3>
        <div class="factor-grid">{layer_cards}</div>
      </div>
      <div class="summary-grid">
        <div class="card">
          <h3>市场空位</h3>
          {gaps}
        </div>
        <div class="card">
          <h3>竞争趋势</h3>
          {trends}
        </div>
      </div>
    </div>
    """


def render_path_analysis(path: dict, fallback_timeline: list[dict]) -> str:
    stages = path.get("stages", []) if path else []
    overall = esc(path.get("overall_judgment", "-")) if path else "-"
    if not stages and not fallback_timeline:
        return "<p class='muted'>暂无关键路径信息。</p>"

    stage_blocks = []
    for item in stages:
        stage_blocks.append(
            f"""
            <div class="path-stage-card">
              <div class="path-stage-head">
                <h5>{esc(item.get("stage", "未命名阶段"))}</h5>
                <span>{esc(item.get("period", "-"))}</span>
              </div>
              <p><strong>阶段主题：</strong>{esc(item.get("strategy_theme", "-"))}</p>
              <p><strong>发生了什么：</strong>{esc(item.get("what_happened", "-"))}</p>
              <p><strong>决策逻辑：</strong>{esc(item.get("decision_logic", "-"))}</p>
              <p><strong>为什么是这个时间点：</strong>{esc(item.get("why_now", "-"))}</p>
              <p><strong>对产品/业务的影响：</strong>{esc(item.get("impact_on_product", "-"))}</p>
              <p><strong>战略信号：</strong>{esc(item.get("business_signal", "-"))}</p>
              <p><strong>下一步推演：</strong>{esc(item.get("next_inference", "-"))}</p>
            </div>
            """
        )

    timeline = render_timeline(fallback_timeline)
    stage_section = (
        "<div class='path-stage-grid'>" + "".join(stage_blocks) + "</div>"
        if stage_blocks
        else ""
    )
    return (
        f"<p><strong>整体路径判断：</strong>{overall}</p>"
        f"{stage_section}"
        "<div class='inner-section'>"
        "<h5>关键节点时间轴</h5>"
        f"{timeline}"
        "</div>"
    )


def render_moat_sources(items: list[dict]) -> str:
    if not items:
        return "<p class='muted'>暂无壁垒来源说明。</p>"
    blocks = []
    for item in items:
        blocks.append(
            f"""
            <div class="mini-card">
              <p><strong>{esc(item.get("type", "-"))}</strong></p>
              <p>{esc(item.get("detail", "-"))}</p>
            </div>
            """
        )
    return "<div class='mini-grid'>" + "".join(blocks) + "</div>"


def render_revenue_streams(items: list[dict]) -> str:
    if not items:
        return "<p class='muted'>暂无收入结构信息。</p>"
    rows = []
    for item in items:
        rows.append(
            "<tr>"
            f"<td>{esc(item.get('name', '-'))}</td>"
            f"<td>{esc(item.get('share', '-'))}</td>"
            f"<td>{esc(item.get('amount', '-'))}</td>"
            f"<td>{esc(item.get('description', '-'))}</td>"
            f"<td>{esc(item.get('strategic_focus', '-'))}</td>"
            f"<td>{esc(item.get('competitors', '-'))}</td>"
            "</tr>"
        )
    return (
        "<table><thead><tr><th>收入项</th><th>占比</th><th>规模</th><th>说明</th><th>战略重心</th><th>对应对手</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table>"
    )


def render_competitors(competitors: list[dict]) -> str:
    if not competitors:
        return "<p class='muted'>暂无竞品卡片。</p>"
    cards = []
    for item in competitors:
        strengths = render_list(item.get("strengths", []))
        weaknesses = render_list(item.get("weaknesses", []))
        factors = render_tags(item.get("competition_factors", []))
        key_metrics = render_key_metrics(item.get("key_metrics", []))
        moat_sources = render_moat_sources(item.get("moat_sources", []))
        revenue_streams = render_revenue_streams(item.get("revenue_streams", []))
        path_analysis = render_path_analysis(
            item.get("company_product_path", {}),
            item.get("company_timeline", []),
        )
        cards.append(
            f"""
            <article class="card competitor-card">
              <h3>{esc(item.get("name", "未命名竞品"))}</h3>
              <p><strong>定位：</strong>{esc(item.get("positioning", "-"))}</p>
              <p><strong>所属企业：</strong>{esc(item.get("company", "-"))}</p>
              <p><strong>业务角色：</strong>{esc(item.get("company_role_in_business", "-"))}</p>
              <p><strong>目标用户：</strong>{esc(item.get("target_users", "-"))}</p>
              <p><strong>核心场景：</strong>{esc(item.get("core_scenarios", "-"))}</p>
              <p><strong>它具体做什么：</strong>{esc(item.get("what_it_does", "-"))}</p>
              <p><strong>目标用户为什么会选它：</strong>{esc(item.get("why_users_choose_it", "-"))}</p>
              <p><strong>解决的核心痛点：</strong>{esc(item.get("pain_point_solved", "-"))}</p>
              <p><strong>是否刚需：</strong>{esc(item.get("hard_need_assessment", "-"))}</p>
              <div><strong>关键竞争要素：</strong>{factors}</div>
              <p><strong>主要能力：</strong>{esc(item.get("capabilities", "-"))}</p>
              <p><strong>关键流程：</strong>{esc(item.get("workflow", "-"))}</p>
              <div class="inner-section">
                <h4>核心壁垒</h4>
                <p><strong>壁垒判断：</strong>{esc(item.get("moat_summary", "-"))}</p>
                <p><strong>为什么更有机会做成：</strong>{esc(item.get("why_it_can_win", "-"))}</p>
                {moat_sources}
              </div>
              <div class="inner-section">
                <h4>盈利模式</h4>
                <p><strong>商业模式：</strong>{esc(item.get("business_model", "-"))}</p>
                <p><strong>具体怎么挣钱：</strong>{esc(item.get("profit_model", "-"))}</p>
                <p><strong>增长闭环/飞轮：</strong>{esc(item.get("growth_flywheel", "-"))}</p>
                <p><strong>模式判断：</strong>{esc(item.get("model_type", "-"))}</p>
                <p><strong>天花板或风险：</strong>{esc(item.get("ceiling_risk", "-"))}</p>
              </div>
              <div class="inner-section">
                <h4>收入结构</h4>
                <p><strong>总体判断：</strong>{esc(item.get("revenue_structure_summary", "-"))}</p>
                {revenue_streams}
              </div>
              <p><strong>业务核心逻辑：</strong>{esc(item.get("business_logic", "-"))}</p>
              <p><strong>患者触达方式：</strong>{esc(item.get("patient_reach", "-"))}</p>
              <p><strong>获客方式：</strong>{esc(item.get("acquisition", "-"))}</p>
              <p><strong>留存方式：</strong>{esc(item.get("retention", "-"))}</p>
              <p><strong>转化方式：</strong>{esc(item.get("conversion", "-"))}</p>
              <p><strong>交付方式：</strong>{esc(item.get("delivery_model", "-"))}</p>
              <p><strong>变现方式：</strong>{esc(item.get("monetization", "-"))}</p>
              <div><strong>关键数据：</strong>{key_metrics}</div>
              <p><strong>企业发展路径：</strong>{esc(item.get("company_path_summary", "-"))}</p>
              <p><strong>产品核心迭代路径：</strong>{esc(item.get("product_iteration_summary", "-"))}</p>
              <div class="two-col">
                <div>
                  <h4>优势</h4>
                  {strengths}
                </div>
                <div>
                  <h4>短板</h4>
                  {weaknesses}
                </div>
              </div>
              <div class="inner-section">
                <h4>企业/产品关键路径</h4>
                {path_analysis}
              </div>
            </article>
            """
        )
    return "<div class='competitor-grid'>" + "".join(cards) + "</div>"


def render_matrix(matrix: list[dict]) -> str:
    if not matrix:
        return "<p class='muted'>暂无横向对比矩阵。</p>"
    headers = ["竞品", "关键竞争要素表现", "业务核心逻辑", "企业路径判断", "总体判断"]
    rows = []
    for item in matrix:
        rows.append(
            "<tr>"
            f"<td>{esc(item.get('name', '-'))}</td>"
            f"<td>{esc(item.get('factor_performance', '-'))}</td>"
            f"<td>{esc(item.get('business_logic', '-'))}</td>"
            f"<td>{esc(item.get('company_path', '-'))}</td>"
            f"<td>{esc(item.get('summary', '-'))}</td>"
            "</tr>"
        )
    head = "".join(f"<th>{esc(header)}</th>" for header in headers)
    return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(rows)}</tbody></table>"


def render_timeline(items: list[dict]) -> str:
    if not items:
        return "<p class='muted'>暂无时间轴信息。</p>"
    blocks = []
    for item in items:
        blocks.append(
            f"""
            <div class="timeline-item">
              <div class="timeline-date">{esc(item.get("date", "-"))}</div>
              <div class="timeline-content">
                <h4>{esc(item.get("title", "-"))}</h4>
                <p>{esc(item.get("description", "-"))}</p>
              </div>
            </div>
            """
        )
    return "<div class='timeline'>" + "".join(blocks) + "</div>"


def render_sources(items: list[dict]) -> str:
    if not items:
        return "<p class='muted'>暂无来源说明。</p>"
    rows = []
    for item in items:
        rows.append(
            "<tr>"
            f"<td>{esc(item.get('name', '-'))}</td>"
            f"<td>{esc(item.get('type', '-'))}</td>"
            f"<td>{esc(item.get('period', '-'))}</td>"
            f"<td>{esc(item.get('note', '-'))}</td>"
            "</tr>"
        )
    return (
        "<table><thead><tr><th>来源</th><th>类型</th><th>时间</th><th>说明</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table>"
    )


def render_report(data: dict) -> str:
    title = esc(data.get("title", "竞品分析报告"))
    generated_at = esc(data.get("generated_at", datetime.now().strftime("%Y-%m-%d %H:%M")))
    goal = esc(data.get("goal", "-"))
    summary = esc(data.get("summary", "-"))
    insights = render_list(data.get("insights", []))
    recommendations = render_list(data.get("recommendations", []))

    factor_cards = "".join(
        f"<div class='factor-card'><h4>{esc(item.get('name', '-'))}</h4><p>{esc(item.get('description', '-'))}</p></div>"
        for item in data.get("competition_factors", [])
    )
    if not factor_cards:
        factor_cards = "<p class='muted'>暂无市场关键竞争要素。</p>"

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <style>
    :root {{
      --bg: #f5f1e8;
      --paper: #fffdf8;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #d7c9ad;
      --accent: #b45309;
      --accent-soft: #f8e7c9;
      --success: #285943;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(180, 83, 9, 0.08), transparent 32%),
        linear-gradient(180deg, #f7f3eb 0%, #efe6d6 100%);
      line-height: 1.6;
    }}
    .wrap {{
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px 64px;
    }}
    .hero {{
      background: linear-gradient(135deg, rgba(180, 83, 9, 0.95), rgba(95, 53, 23, 0.92));
      color: white;
      border-radius: 24px;
      padding: 32px;
      box-shadow: 0 24px 60px rgba(54, 37, 18, 0.18);
    }}
    .hero h1 {{ margin: 0 0 12px; font-size: 34px; }}
    .hero p {{ margin: 8px 0; opacity: 0.95; }}
    .section {{
      margin-top: 24px;
      background: rgba(255, 253, 248, 0.92);
      border: 1px solid rgba(215, 201, 173, 0.8);
      border-radius: 20px;
      padding: 24px;
      backdrop-filter: blur(6px);
    }}
    .section h2 {{
      margin: 0 0 16px;
      font-size: 24px;
    }}
    .card,
    .factor-card {{
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 16px;
      box-shadow: 0 10px 20px rgba(77, 52, 25, 0.06);
    }}
    .summary-grid,
    .factor-grid,
    .competitor-grid {{
      display: grid;
      gap: 16px;
    }}
    .summary-grid {{
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }}
    .factor-grid {{
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }}
    .mini-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin-top: 10px;
    }}
    .mini-card {{
      background: #fff9ef;
      border: 1px solid #ead8b8;
      border-radius: 14px;
      padding: 12px;
    }}
    .mini-card p {{
      margin: 4px 0;
      font-size: 14px;
    }}
    .competitor-grid {{
      grid-template-columns: 1fr;
    }}
    .landscape-wrap {{
      display: grid;
      gap: 16px;
    }}
    .axis-copy p {{
      margin: 6px 0;
    }}
    .scatter-layout {{
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
      gap: 12px;
      margin-top: 12px;
    }}
    .scatter-panel {{
      min-width: 0;
    }}
    .scatter-plot {{
      position: relative;
      min-height: 420px;
      border: 1px solid #ead8b8;
      border-radius: 18px;
      background:
        linear-gradient(180deg, rgba(248, 231, 201, 0.25), rgba(255, 253, 248, 0.9));
      overflow: hidden;
    }}
    .scatter-axis {{
      position: absolute;
      background: #d3b17f;
    }}
    .scatter-axis-x {{
      left: 0;
      right: 0;
      top: 50%;
      height: 2px;
    }}
    .scatter-axis-y {{
      top: 0;
      bottom: 0;
      left: 50%;
      width: 2px;
    }}
    .scatter-corner {{
      position: absolute;
      font-size: 12px;
      color: #8c5a24;
      font-weight: 700;
      background: rgba(255, 253, 248, 0.88);
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid rgba(215, 201, 173, 0.8);
    }}
    .scatter-corner-lt {{
      top: 12px;
      left: 12px;
    }}
    .scatter-corner-rt {{
      top: 12px;
      right: 12px;
    }}
    .scatter-corner-lb {{
      bottom: 12px;
      left: 12px;
    }}
    .scatter-corner-rb {{
      bottom: 12px;
      right: 12px;
    }}
    .scatter-point {{
      position: absolute;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.92);
      box-shadow: 0 8px 18px rgba(77, 52, 25, 0.18);
    }}
    .scatter-point span {{
      position: absolute;
      left: calc(100% + 8px);
      top: 50%;
      transform: translateY(-50%);
      white-space: nowrap;
      font-size: 13px;
      font-weight: 700;
      color: #2f3947;
    }}
    .scatter-detail {{
      display: grid;
      gap: 10px;
      align-content: start;
    }}
    .landscape-item {{
      background: #fff9ef;
      border: 1px solid #ead8b8;
      border-radius: 14px;
      padding: 12px;
      margin-top: 10px;
    }}
    .landscape-item p {{
      margin: 4px 0;
    }}
    .swatch {{
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 8px;
      vertical-align: middle;
    }}
    .pie-chart-panel {{
      display: grid;
      grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
      gap: 18px;
      align-items: center;
    }}
    .pie-chart {{
      width: 200px;
      height: 200px;
      border-radius: 50%;
      margin: 0 auto;
      border: 8px solid rgba(255, 255, 255, 0.9);
      box-shadow: inset 0 0 0 1px rgba(215, 201, 173, 0.8);
    }}
    .pie-legend {{
      display: grid;
      gap: 10px;
    }}
    .pie-legend-item {{
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }}
    .market-structure-note {{
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px dashed var(--line);
    }}
    .market-structure-note p {{
      margin: 6px 0;
    }}
    .timeline-date {{
      color: var(--accent);
      font-weight: 700;
    }}
    .muted {{
      color: var(--muted);
      font-size: 14px;
    }}
    .tag {{
      display: inline-block;
      margin: 6px 8px 0 0;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: #7c3f00;
      font-size: 13px;
    }}
    .two-col {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }}
    .inner-section {{
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px dashed var(--line);
    }}
    .path-stage-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }}
    .path-stage-card {{
      background: #fff9ef;
      border: 1px solid #ead8b8;
      border-radius: 16px;
      padding: 14px;
    }}
    .path-stage-card h5 {{
      margin: 0;
      font-size: 16px;
    }}
    .path-stage-card p {{
      margin: 8px 0 0;
      font-size: 14px;
    }}
    .path-stage-head {{
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
      color: #7c3f00;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 14px;
      background: white;
    }}
    th, td {{
      padding: 12px 14px;
      border-bottom: 1px solid #eadfca;
      text-align: left;
      vertical-align: top;
    }}
    th {{
      background: #f6ead5;
      color: #6d3a0f;
      font-weight: 700;
    }}
    .timeline {{
      position: relative;
      padding-left: 20px;
      border-left: 3px solid #d9b27d;
    }}
    .timeline-item {{
      position: relative;
      padding: 0 0 20px 16px;
    }}
    .timeline-item::before {{
      content: "";
      position: absolute;
      left: -11px;
      top: 4px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 4px #f6ead5;
    }}
    .footer-note {{
      margin-top: 20px;
      color: var(--muted);
      font-size: 13px;
    }}
    @media (max-width: 720px) {{
      .hero h1 {{ font-size: 28px; }}
      .wrap {{ padding: 20px 14px 40px; }}
      .section, .hero {{ padding: 20px; }}
      .scatter-layout,
      .pie-chart-panel {{
        grid-template-columns: 1fr;
      }}
      .scatter-plot {{
        min-height: 320px;
      }}
      .scatter-point span {{
        font-size: 12px;
      }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <p>产品经理竞品分析报告</p>
      <h1>{title}</h1>
      <p><strong>生成时间：</strong>{generated_at}</p>
      <p><strong>分析目标：</strong>{goal}</p>
      <p><strong>一句话结论：</strong>{summary}</p>
    </header>

    <section class="section">
      <h2>关键结论</h2>
      <div class="summary-grid">
        <div class="card">
          <h3>洞察</h3>
          {insights}
        </div>
        <div class="card">
          <h3>建议</h3>
          {recommendations}
        </div>
      </div>
    </section>

    <section class="section">
      <h2>目标市场</h2>
      {render_market(data.get("target_market", {}))}
    </section>

    <section class="section">
      <h2>用户画像</h2>
      {render_personas(data.get("user_personas", []))}
    </section>

    <section class="section">
      <h2>市场关键竞争要素</h2>
      <div class="factor-grid">{factor_cards}</div>
    </section>

    <section class="section">
      <h2>市场竞争格局</h2>
      {render_market_landscape(data.get("market_landscape", {}))}
    </section>

    <section class="section">
      <h2>核心竞品卡片</h2>
      {render_competitors(data.get("competitors", []))}
    </section>

    <section class="section">
      <h2>横向比较矩阵</h2>
      {render_matrix(data.get("comparison_matrix", []))}
    </section>

    <section class="section">
      <h2>行业发展路径</h2>
      {render_timeline(data.get("industry_timeline", data.get("timeline", [])))}
    </section>

    <section class="section">
      <h2>数据来源</h2>
      {render_sources(data.get("sources", []))}
      <p class="footer-note">请在正式使用前核对数据时间、口径和来源可信度。</p>
    </section>
  </div>
</body>
</html>
"""


def main() -> int:
    if len(sys.argv) != 3:
        print("用法: python render_html_report.py input.json output.html")
        return 1

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not input_path.exists():
        print(f"未找到输入文件: {input_path}")
        return 1

    with input_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    output_path.write_text(render_report(data), encoding="utf-8")
    print(f"已生成 HTML 报告: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
