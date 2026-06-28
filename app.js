const solfege = [
  { label: "ド", semitone: 0 },
  { label: "レ", semitone: 2 },
  { label: "ミ", semitone: 4 },
  { label: "ファ", semitone: 5 },
  { label: "ソ", semitone: 7 },
  { label: "ラ", semitone: 9 },
  { label: "シ", semitone: 11 },
  { label: "ド", semitone: 12 }
];

const paperSizes = {
  a4: { width: 210, height: 297, label: "A4" },
  letter: { width: 215.9, height: 279.4, label: "Letter" },
  a3: { width: 297, height: 420, label: "A3" }
};

const noteColors = ["#137c7a", "#d99225", "#486fa8", "#b95d6b", "#5d7f3c", "#9d6a2d", "#6c6aa6", "#0d5e5c"];

const controls = {
  tonic: document.querySelector("#tonic"),
  tuningModel: document.querySelector("#tuningModel"),
  baseLength: document.querySelector("#baseLength"),
  paperSize: document.querySelector("#paperSize"),
  margin: document.querySelector("#margin"),
  innerRadius: document.querySelector("#innerRadius"),
  notePitch: document.querySelector("#notePitch"),
  fanAngle: document.querySelector("#fanAngle"),
  tabWidth: document.querySelector("#tabWidth")
};

const outputs = {
  baseLength: document.querySelector("#baseLengthOut"),
  innerRadius: document.querySelector("#innerRadiusOut"),
  notePitch: document.querySelector("#notePitchOut"),
  fanAngle: document.querySelector("#fanAngleOut"),
  tabWidth: document.querySelector("#tabWidthOut")
};

const svg = document.querySelector("#templateSvg");
const noteTable = document.querySelector("#noteTable");
const fitStatus = document.querySelector("#fitStatus");

let audioContext;
let currentNotes = [];

function getSettings() {
  return {
    tonicMidi: Number(controls.tonic.value),
    tuningModel: controls.tuningModel.value,
    baseLength: Number(controls.baseLength.value),
    paperSize: paperSizes[controls.paperSize.value],
    margin: Number(controls.margin.value),
    innerRadius: Number(controls.innerRadius.value),
    notePitch: Number(controls.notePitch.value),
    fanAngle: Number(controls.fanAngle.value),
    tabWidth: Number(controls.tabWidth.value)
  };
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteLength(baseLength, baseFrequency, frequency, model) {
  const ratio = baseFrequency / frequency;
  return baseLength * (model === "reed" ? Math.sqrt(ratio) : ratio);
}

function polar(cx, cy, radius, degrees) {
  const radians = (degrees - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians)
  };
}

function arcPath(cx, cy, radius, startAngle, endAngle) {
  const start = polar(cx, cy, radius, startAngle);
  const end = polar(cx, cy, radius, endAngle);
  const largeArc = Math.abs(endAngle - startAngle) <= 180 ? 0 : 1;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

function annularPath(cx, cy, inner, outer, startAngle, endAngle) {
  const a = polar(cx, cy, outer, startAngle);
  const b = polar(cx, cy, outer, endAngle);
  const c = polar(cx, cy, inner, endAngle);
  const d = polar(cx, cy, inner, startAngle);
  const largeArc = Math.abs(endAngle - startAngle) <= 180 ? 0 : 1;
  return [
    `M ${a.x.toFixed(3)} ${a.y.toFixed(3)}`,
    `A ${outer.toFixed(3)} ${outer.toFixed(3)} 0 ${largeArc} 1 ${b.x.toFixed(3)} ${b.y.toFixed(3)}`,
    `L ${c.x.toFixed(3)} ${c.y.toFixed(3)}`,
    `A ${inner.toFixed(3)} ${inner.toFixed(3)} 0 ${largeArc} 0 ${d.x.toFixed(3)} ${d.y.toFixed(3)}`,
    "Z"
  ].join(" ");
}

function linePath(cx, cy, inner, outer, angle) {
  const start = polar(cx, cy, inner, angle);
  const end = polar(cx, cy, outer, angle);
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} L ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

function buildNotes(settings) {
  const baseFrequency = midiToFrequency(settings.tonicMidi);
  return solfege.map((note, index) => {
    const midi = settings.tonicMidi + note.semitone;
    const frequency = midiToFrequency(midi);
    return {
      ...note,
      index,
      midi,
      frequency,
      length: noteLength(settings.baseLength, baseFrequency, frequency, settings.tuningModel),
      radius: settings.innerRadius + index * settings.notePitch
    };
  });
}

function renderTable(notes) {
  noteTable.innerHTML = "";
  const fragment = document.createDocumentFragment();
  notes.forEach((note) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><button type="button" aria-label="${note.label}を再生" data-note="${note.index}">♪</button> ${note.label}</td>
      <td>${note.frequency.toFixed(1)} Hz</td>
      <td>${note.length.toFixed(1)} mm</td>
    `;
    fragment.appendChild(tr);
  });
  noteTable.appendChild(fragment);
}

function renderSvg(settings, notes) {
  const paper = settings.paperSize;
  const outerRadius = settings.innerRadius + (notes.length - 1) * settings.notePitch + settings.notePitch * 0.72;
  const center = {
    x: paper.width / 2,
    y: Math.min(paper.height - settings.margin - 14, outerRadius + settings.margin + 36)
  };
  const startAngle = -settings.fanAngle / 2;
  const endAngle = settings.fanAngle / 2;
  const minRadius = Math.max(6, settings.innerRadius - settings.notePitch * 0.72);
  const requiredHeight = center.y + settings.margin;
  const isFit = center.y - outerRadius > settings.margin && requiredHeight <= paper.height;
  let hasShortenedSlots = false;

  svg.setAttribute("viewBox", `0 0 ${paper.width} ${paper.height}`);
  svg.setAttribute("width", `${paper.width}mm`);
  svg.setAttribute("height", `${paper.height}mm`);
  svg.innerHTML = "";

  const ns = "http://www.w3.org/2000/svg";
  const add = (tag, attrs, parent = svg) => {
    const element = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    parent.appendChild(element);
    return element;
  };

  add("rect", {
    x: 0,
    y: 0,
    width: paper.width,
    height: paper.height,
    fill: "#fbfaf6"
  });

  add("rect", {
    x: settings.margin,
    y: settings.margin,
    width: paper.width - settings.margin * 2,
    height: paper.height - settings.margin * 2,
    fill: "none",
    stroke: "#d6d2c8",
    "stroke-width": "0.35",
    "stroke-dasharray": "3 2"
  });

  add("path", {
    d: annularPath(center.x, center.y, minRadius, outerRadius, startAngle, endAngle),
    fill: "#fffaf0",
    stroke: "#20262b",
    "stroke-width": "0.55"
  });

  add("circle", {
    cx: center.x,
    cy: center.y,
    r: "2.2",
    fill: "#20262b"
  });

  [startAngle, 0, endAngle].forEach((angle) => {
    add("path", {
      d: linePath(center.x, center.y, minRadius, outerRadius, angle),
      fill: "none",
      stroke: angle === 0 ? "#20262b" : "#9a9489",
      "stroke-width": angle === 0 ? "0.32" : "0.24",
      "stroke-dasharray": angle === 0 ? "2.4 1.8" : "1.4 1.4"
    });
  });

  notes.forEach((note) => {
    const group = add("g", { class: "template-note", "data-note": note.index });
    const radiusInner = note.radius - settings.tabWidth / 2;
    const radiusOuter = note.radius + settings.tabWidth / 2;
    const slotAngle = Math.min(settings.fanAngle - 10, Math.max(16, note.length / note.radius * 180 / Math.PI));
    const slotStart = -slotAngle / 2;
    const slotEnd = slotAngle / 2;
    const labelPoint = polar(center.x, center.y, note.radius, 0);
    const cutColor = noteColors[note.index % noteColors.length];
    const rawSlotAngle = note.length / note.radius * 180 / Math.PI;
    if (rawSlotAngle > settings.fanAngle - 10) {
      hasShortenedSlots = true;
    }

    add("path", {
      d: arcPath(center.x, center.y, note.radius, startAngle, endAngle),
      fill: "none",
      stroke: "#d0c8ba",
      "stroke-width": "0.25"
    }, group);

    add("path", {
      class: "note-band",
      d: annularPath(center.x, center.y, radiusInner, radiusOuter, slotStart, slotEnd),
      fill: cutColor,
      opacity: "0.14",
      stroke: cutColor,
      "stroke-width": "0.7"
    }, group);

    add("path", {
      d: arcPath(center.x, center.y, note.radius, slotStart, slotEnd),
      fill: "none",
      stroke: cutColor,
      "stroke-width": "1.15",
      "stroke-linecap": "round"
    }, group);

    add("circle", {
      cx: polar(center.x, center.y, note.radius, slotStart).x.toFixed(3),
      cy: polar(center.x, center.y, note.radius, slotStart).y.toFixed(3),
      r: "1.45",
      fill: "#fbfaf6",
      stroke: cutColor,
      "stroke-width": "0.45"
    }, group);

    add("circle", {
      cx: polar(center.x, center.y, note.radius, slotEnd).x.toFixed(3),
      cy: polar(center.x, center.y, note.radius, slotEnd).y.toFixed(3),
      r: "1.45",
      fill: "#fbfaf6",
      stroke: cutColor,
      "stroke-width": "0.45"
    }, group);

    add("text", {
      x: (labelPoint.x + 3).toFixed(3),
      y: labelPoint.y.toFixed(3),
      fill: "#20262b",
      "font-size": "4.2",
      "font-weight": "700",
      "text-anchor": "start",
      "dominant-baseline": "middle"
    }, group).textContent = `${note.label} ${note.length.toFixed(1)}mm`;
  });

  const title = add("text", {
    x: settings.margin,
    y: settings.margin + 6,
    fill: "#20262b",
    "font-size": "5",
    "font-weight": "700"
  });
  title.textContent = `扇風琴型紙 / ${paper.label} / ${settings.tuningModel === "reed" ? "紙リード" : "空気柱"}モデル`;

  const caption = add("text", {
    x: settings.margin,
    y: settings.margin + 13,
    fill: "#65717c",
    "font-size": "3.3"
  });
  caption.textContent = "実線: 切り込み  破線: 中心線・外形ガイド  丸穴: 切り込み止め";

  addRuler(settings.margin, paper.height - settings.margin - 7, 50, ns);

  if (!isFit) {
    fitStatus.textContent = "用紙からはみ出す設定です。半径、間隔、角度、または用紙を調整してください。";
    fitStatus.style.color = "#9b3434";
  } else if (hasShortenedSlots) {
    fitStatus.textContent = "一部の切り込みが扇の角度より長いため短縮表示しています。ドの舌片長を短くするか、内側半径や扇の角度を大きくしてください。";
    fitStatus.style.color = "#9b6a00";
  } else {
    fitStatus.textContent = "印刷後、実音を聞きながら舌片を少しずつ短くして微調整してください。";
    fitStatus.style.color = "";
  }
}

function addRuler(x, y, length, ns) {
  const group = document.createElementNS(ns, "g");
  svg.appendChild(group);
  const line = document.createElementNS(ns, "line");
  line.setAttribute("x1", x);
  line.setAttribute("x2", x + length);
  line.setAttribute("y1", y);
  line.setAttribute("y2", y);
  line.setAttribute("stroke", "#20262b");
  line.setAttribute("stroke-width", "0.35");
  group.appendChild(line);

  for (let i = 0; i <= length; i += 10) {
    const tick = document.createElementNS(ns, "line");
    tick.setAttribute("x1", x + i);
    tick.setAttribute("x2", x + i);
    tick.setAttribute("y1", y - 1.5);
    tick.setAttribute("y2", y + 1.5);
    tick.setAttribute("stroke", "#20262b");
    tick.setAttribute("stroke-width", "0.35");
    group.appendChild(tick);
  }

  const text = document.createElementNS(ns, "text");
  text.setAttribute("x", x + length + 3);
  text.setAttribute("y", y + 1.1);
  text.setAttribute("font-size", "3.2");
  text.setAttribute("fill", "#20262b");
  text.textContent = "50 mm";
  group.appendChild(text);
}

function render() {
  const settings = getSettings();
  outputs.baseLength.textContent = settings.baseLength;
  outputs.innerRadius.textContent = settings.innerRadius;
  outputs.notePitch.textContent = settings.notePitch;
  outputs.fanAngle.textContent = settings.fanAngle;
  outputs.tabWidth.textContent = settings.tabWidth;

  currentNotes = buildNotes(settings);
  renderTable(currentNotes);
  renderSvg(settings, currentNotes);
}

function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

function playTone(frequency, delay = 0, duration = 0.34) {
  const ctx = ensureAudio();
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.16, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.04);
}

function playNoteByIndex(index) {
  const note = currentNotes[index];
  if (note) playTone(note.frequency);
}

function downloadSvg() {
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svg);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "senpukin-template.svg";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

Object.values(controls).forEach((control) => control.addEventListener("input", render));

document.querySelector("#playScale").addEventListener("click", () => {
  currentNotes.forEach((note, index) => playTone(note.frequency, index * 0.28, 0.28));
});

document.querySelector("#printTemplate").addEventListener("click", () => window.print());
document.querySelector("#downloadSvg").addEventListener("click", downloadSvg);

noteTable.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-note]");
  if (button) playNoteByIndex(Number(button.dataset.note));
});

svg.addEventListener("click", (event) => {
  const noteGroup = event.target.closest(".template-note");
  if (noteGroup) playNoteByIndex(Number(noteGroup.dataset.note));
});

render();
