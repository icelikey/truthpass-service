import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = "E:/黑客松";
const sourceDir = path.join(workspaceDir, "pitch-deck", "v0.8.1");
const outDir = path.join(workspaceDir, "pitch-deck", "v0.8.2");
const buildDir = path.join(workspaceDir, ".ppt_rebuild_v0.8.2");
const finalPath = path.join(outDir, "TruthPass-下一代交易模式-BP-v0.8.2.pptx");
const W = 1280;
const H = 720;

const C = {
  navy: "#061A31",
  navy2: "#0A2B4A",
  cyan: "#19D8FF",
  cyan2: "#83F3FF",
  blue: "#4A8DFF",
  white: "#F5FBFF",
  muted: "#B7D4E8",
  amber: "#FFCA5B",
  amber2: "#FFE7A2",
  line: "#2B78AE",
};

const esc = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const text = (x, y, content, opts = {}) => {
  const {
    size = 24,
    color = C.white,
    weight = 500,
    anchor = "start",
    line = Math.round(size * 1.35),
    letter = 0,
    opacity = 1,
  } = opts;
  const lines = String(content).split("\n");
  const tspans = lines.map((lineText, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : line}">${esc(lineText)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" fill="${color}" font-family="Microsoft YaHei, Noto Sans CJK SC, Arial, sans-serif" font-size="${size}px" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${letter}px" opacity="${opacity}" dominant-baseline="hanging">${tspans}</text>`;
};

const rect = (x, y, w, h, fill, radius = 0, stroke = "none", sw = 0, opacity = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>`;
const line = (x1, y1, x2, y2, stroke, sw = 2, dash = "") =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
const circle = (cx, cy, r, fill, stroke = "none", sw = 0, opacity = 1) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>`;

const defs = `
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#06172B"/><stop offset="60%" stop-color="#0A3154"/><stop offset="100%" stop-color="#061426"/></linearGradient>
  <linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0E3D66" stop-opacity="0.95"/><stop offset="100%" stop-color="#071A31" stop-opacity="0.92"/></linearGradient>
  <linearGradient id="cyan" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#19D8FF"/><stop offset="100%" stop-color="#4A8DFF"/></linearGradient>
  <filter id="glow"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#2E7EAB" stroke-width="1" opacity="0.16"/></pattern>
</defs>`;

const shell = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#grid)"/>${body}</svg>`;
const logo = () => `${rect(28, 24, 206, 58, "#071A31", 15, C.cyan, 1.5)}<path d="M48 37 L64 31 L80 37 V49 C80 60 72 68 64 72 C56 68 48 60 48 49Z" fill="none" stroke="${C.cyan2}" stroke-width="2"/><path d="M56 50 L62 56 L73 44" fill="none" stroke="${C.cyan2}" stroke-width="2.5"/>${text(94, 37, "TruthPass", { size: 23, weight: 800, color: C.white })}`;
const page = (n) => text(1218, 672, String(n).padStart(2, "0"), { size: 15, weight: 700, color: C.cyan2, anchor: "end", letter: 1.3 });
const section = (label) => text(52, 112, label.toUpperCase(), { size: 13, weight: 800, color: C.cyan2, letter: 2.2 });
const heading = (label, y = 150, size = 43) => text(52, y, label, { size, weight: 800, color: C.white, line: Math.round(size * 1.14), letter: -1.1 });

function expansionSlide() {
  let b = `${logo()}${section("12 未来扩展")}${heading("鱼油只是第一种可信商品")}`;
  b += text(52, 238, "同一套证据接口、Agent 选择和公共信誉，可以服务更多真正需要信任的品类。", { size: 22, color: C.muted });
  const cards = [
    [52, 326, "营养补充", "鱼油 / 益生菌 / 蛋白粉", "成分、含量、氧化与储运", C.cyan],
    [342, 326, "婴童与宠物", "奶粉 / 婴童 / 宠物食品", "原料、批次、复检与召回", C.blue],
    [632, 326, "个护与家居", "护肤 / 个护 / 小家电", "配方、能耗、维修与售后", C.amber],
    [922, 326, "可信服务", "检测 / 物流 / 安装维修", "能力、响应和履约结果", C.cyan2],
  ];
  for (const [x, y, title, sub, detail, color] of cards) {
    b += rect(x, y, 254, 226, "url(#card)", 20, color, 1.5);
    b += circle(x + 42, y + 48, 20, color, "none", 0, 0.16);
    b += circle(x + 42, y + 48, 8, color);
    b += text(x + 76, y + 30, title, { size: 23, weight: 800, color: C.white });
    b += text(x + 26, y + 96, sub, { size: 17, weight: 700, color });
    b += text(x + 26, y + 142, detail, { size: 16, color: C.muted, line: 25 });
  }
  b += text(52, 610, "优先选择：价格或安全影响高、过程可观测、批次可绑定、消费者难以自行判断。", { size: 20, weight: 700, color: C.amber2 });
  b += page(14);
  return shell(b);
}

function brandGrowthSlide() {
  let b = `${logo()}${section("13 白牌品牌成长")}${heading("让白牌商家先用证据建立品牌")}`;
  b += text(52, 238, "品牌不再先靠广告被记住，而是通过每一批经得起回看的交付记录被理解。", { size: 22, color: C.muted });
  const steps = [
    [86, "01", "低成本接入", "批次、报告、物流和售后\n先通过 CSV / API 接入"],
    [414, "02", "持续交付", "每批记录证据\n缺口和争议公开可见"],
    [742, "03", "信誉增长", "复购、推荐、检测和\n供应链能力持续累积"],
  ];
  for (let i = 0; i < steps.length; i += 1) {
    const [x, no, title, detail] = steps[i];
    b += rect(x, 336, 272, 190, "url(#card)", 20, i === 1 ? C.amber : C.cyan, 1.6);
    b += circle(x + 42, 378, 24, i === 1 ? C.amber : C.cyan);
    b += text(x + 42, 368, no, { size: 15, weight: 900, color: C.navy, anchor: "middle" });
    b += text(x + 80, 360, title, { size: 23, weight: 800, color: C.white });
    b += line(x + 28, 420, x + 242, 420, C.line, 1);
    b += text(x + 28, 448, detail, { size: 17, weight: 600, color: C.muted, line: 28 });
    if (i < steps.length - 1) b += line(x + 274, 430, x + 314, 430, C.cyan2, 3);
  }
  b += rect(216, 584, 848, 54, "#103E62", 27, C.cyan, 1);
  b += text(640, 598, "品牌 = 每一批都经得起回看的公共信誉", { size: 22, weight: 800, color: C.white, anchor: "middle" });
  b += page(15);
  return shell(b);
}

function flywheelSlide() {
  let b = `${logo()}${section("14 良币增长飞轮")}${heading("让真正的好产品越来越容易被选择")}`;
  b += text(52, 238, "当证据能被复用，消费者的选择会反过来改善下一批生产。", { size: 22, color: C.muted });
  b += circle(640, 454, 112, "#0C4168", C.cyan, 2);
  b += circle(640, 454, 82, "#071A31", C.cyan2, 1.5);
  b += text(640, 428, "公共信誉", { size: 29, weight: 800, color: C.white, anchor: "middle" });
  b += text(640, 470, "每次交付都留下参考", { size: 16, weight: 700, color: C.cyan2, anchor: "middle" });
  const nodes = [
    [640, 314, "证据", "生产 / 检测 / 物流", C.cyan],
    [902, 404, "选择", "Agent 匹配需求", C.blue],
    [800, 594, "反馈", "购买后授权贡献", C.amber],
    [480, 594, "改进", "生产方获得信号", C.cyan2],
    [378, 404, "复购", "好产品获得回报", C.cyan],
  ];
  for (const [x, y, title, sub, color] of nodes) {
    b += line(640, 454, x, y, color, 2, "8 8");
    b += circle(x, y, 55, "#0A2B4A", color, 2);
    b += text(x, y - 16, title, { size: 20, weight: 800, color, anchor: "middle" });
    b += text(x, y + 12, sub, { size: 13, weight: 600, color: C.muted, anchor: "middle" });
  }
  b += text(52, 652, "流量带来一次曝光，证据带来可持续的选择。", { size: 20, weight: 800, color: C.amber2 });
  b += page(16);
  return shell(b);
}

const newSlides = [
  { name: "14-expansion.png", svg: expansionSlide(), note: "鱼油是第一个容易讲清楚的案例。未来扩展到营养补充、婴童与宠物、个护家居以及检测和物流等可信服务。选择标准是信息不对称明显、过程可观测、批次或任务可绑定。" },
  { name: "15-brand-growth.png", svg: brandGrowthSlide(), note: "白牌商家不需要一开始改造整条产线。先提交已有批次、报告、物流和售后数据，再通过持续交付积累公共信誉。品牌从广告认知，转向每一批经得起回看的记录。" },
  { name: "16-quality-flywheel.png", svg: flywheelSlide(), note: "良币驱逐劣币不是口号，而是一条增长飞轮：证据、Agent 选择、购买反馈、生产改进、复购和信誉累积。只有持续交付，才能获得长期优势。" },
];

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(buildDir, { recursive: true });
for (let index = 1; index <= 15; index += 1) {
  const source = path.join(sourceDir, `${String(index).padStart(2, "0")}-${[
    "cover", "who-we-are", "why-now", "consumer-problem", "producer-problem", "existing-gap", "why-us", "what-we-do", "transaction-flow", "data-sources", "blockchain-role", "fish-oil-demo", "outcomes", "new-transaction-relation", "vision",
  ][index - 1]}.png`);
  await fs.copyFile(source, path.join(outDir, path.basename(source)));
}

const presentation = Presentation.create({ slideSize: { width: W, height: H } });
const notes = [];
const originalNames = [
  "01-cover.png", "02-who-we-are.png", "03-why-now.png", "04-consumer-problem.png", "05-producer-problem.png", "06-existing-gap.png", "07-why-us.png", "08-what-we-do.png", "09-transaction-flow.png", "10-data-sources.png", "11-blockchain-role.png", "12-fish-oil-demo.png", "13-outcomes.png",
];
for (let index = 0; index < originalNames.length; index += 1) {
  const slide = presentation.slides.add();
  slide.images.add({ blob: await fs.readFile(path.join(sourceDir, originalNames[index])), contentType: "image/png", fit: "cover", position: { left: 0, top: 0, width: W, height: H }, alt: "TruthPass BP 原有页面" });
  notes.push(`原有第 ${index + 1} 页，内容保持 v0.8.1。`);
}
for (const item of newSlides) {
  const slide = presentation.slides.add();
  const svgData = `data:image/svg+xml;base64,${Buffer.from(item.svg, "utf8").toString("base64")}`;
  slide.images.add({ dataUrl: svgData, contentType: "image/svg+xml", fit: "cover", position: { left: 0, top: 0, width: W, height: H }, alt: item.name });
  notes.push(item.note);
}
for (const originalName of ["14-new-transaction-relation.png", "15-vision.png"]) {
  const slide = presentation.slides.add();
  slide.images.add({ blob: await fs.readFile(path.join(sourceDir, originalName)), contentType: "image/png", fit: "cover", position: { left: 0, top: 0, width: W, height: H }, alt: "TruthPass BP 原有页面" });
  notes.push(originalName === "14-new-transaction-relation.png" ? "新的交易关系如何形成，内容保持 v0.8.1。" : "最终愿景，内容保持 v0.8.1；新增扩展页已在其前面展开。 ");
}

for (let index = 0; index < notes.length; index += 1) {
  presentation.slides.getItem(index).speakerNotes.textFrame.setText(notes[index]);
}

const candidatePath = path.join(buildDir, "candidate.pptx");
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
for (let index = 0; index < notes.length; index += 1) {
  const preview = await presentation.export({ slide: presentation.slides.getItem(index), format: "png", scale: 1 });
  await fs.writeFile(path.join(buildDir, `slide-${String(index + 1).padStart(2, "0")}.png`), new Uint8Array(await preview.arrayBuffer()));
}
await fs.copyFile(path.join(sourceDir, "README.md"), path.join(outDir, "README-v0.8.1-source.md"));
console.log(JSON.stringify({ finalPath, slideCount: notes.length, newSlides: newSlides.map((item) => item.name) }, null, 2));
