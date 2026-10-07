import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = "E:/黑客松";
const outDir = path.join(workspaceDir, "pitch-deck", "v0.8.3");
const buildDir = path.join(workspaceDir, ".ppt_rebuild_v0.8.3");
const finalPath = path.join(outDir, "TruthPass-下一代交易模式-BP-v0.8.3-imagegen.pptx");
const W = 1280;
const H = 720;

const slides = [
  ["01-cover.png", "封面，保持原版 ImageGen 图文页。"],
  ["02-who-we-are.png", "我们是谁，保持原版 ImageGen 图文页。"],
  ["03-why-now.png", "为什么现在，保持原版 ImageGen 图文页。"],
  ["04-consumer-problem.png", "消费者问题，保持原版 ImageGen 图文页。"],
  ["05-producer-problem.png", "生产方问题，保持原版 ImageGen 图文页。"],
  ["06-existing-gap.png", "现有方案缺口，保持原版 ImageGen 图文页。"],
  ["07-why-us.png", "为什么是我们，保持原版 ImageGen 图文页。"],
  ["08-what-we-do.png", "我们具体做什么，保持原版 ImageGen 图文页。"],
  ["09-transaction-flow.png", "一次交易如何发生，保持原版 ImageGen 图文页。"],
  ["10-data-sources.png", "数据从哪里来，保持原版 ImageGen 图文页。"],
  ["11-blockchain-role.png", "区块链具体放在哪里，保持原版 ImageGen 图文页。"],
  ["12-fish-oil-demo.png", "鱼油 Demo；页面中的数据仍标注为 demo / synthetic。"],
  ["13-outcomes.png", "达成什么效果，保持原版 ImageGen 图文页。"],
  ["14-expansion-imagegen.png", "ImageGen 原生新增页：鱼油只是第一种可信商品，展示未来品类扩展。"],
  ["15-brand-growth-imagegen.png", "ImageGen 原生新增页：白牌商家先用证据建立品牌。"],
  ["16-quality-flywheel-imagegen.png", "ImageGen 原生新增页：证据、选择、反馈、改进和复购形成增长飞轮。"],
  ["17-new-transaction-relation.png", "新的交易关系如何形成，保持原版 ImageGen 图文页。"],
  ["18-vision.png", "最终愿景，保持原版 ImageGen 图文页。"],
];

await fs.mkdir(buildDir, { recursive: true });
const presentation = Presentation.create({ slideSize: { width: W, height: H } });
for (const [filename, note] of slides) {
  const slide = presentation.slides.add();
  slide.images.add({
    blob: await fs.readFile(path.join(outDir, filename)),
    contentType: "image/png",
    fit: "cover",
    position: { left: 0, top: 0, width: W, height: H },
    alt: `TruthPass ImageGen slide ${filename}`,
  });
  slide.speakerNotes.textFrame.setText(note);
}
const candidatePath = path.join(buildDir, "candidate.pptx");
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
for (let index = 0; index < slides.length; index += 1) {
  const preview = await presentation.export({ slide: presentation.slides.getItem(index), format: "png", scale: 1 });
  await fs.writeFile(path.join(buildDir, `slide-${String(index + 1).padStart(2, "0")}.png`), new Uint8Array(await preview.arrayBuffer()));
}
await fs.copyFile(candidatePath, finalPath);
console.log(JSON.stringify({ finalPath, slideCount: slides.length, nativeImageGenSlides: [14, 15, 16] }, null, 2));
