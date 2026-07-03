import {
  _decorator,
  Component,
  Color,
  Graphics,
  HorizontalTextAlignment,
  Label,
  Node,
  UITransform,
  Vec3,
  VerticalTextAlignment,
} from 'cc';

const { ccclass, property } = _decorator;

type PotSize = 'small' | 'medium' | 'large';

interface Pot {
  id: number;
  size: PotSize;
  spawnTime: number;
  expireTime: number;
  resolved: null | 'player' | 'ai';
}

interface BarFill {
  node: Node;
  transform: UITransform;
  graphics: Graphics;
  color: Color;
  width: number;
  height: number;
}

/**
 * 《别让 AI 转正》v5 —— 单条认可度 + 锅（分大小）+ 甩锅救大放小。
 * 数值与 scripts/sim/sim.ts 的 LEVEL_5 同源，已模拟验证胜率连续分布。
 */
@ccclass('GameRoot')
export class GameRoot extends Component {
  @property(Label) public approvalLabel: Label | null = null;
  @property(Label) public bossStatusLabel: Label | null = null;
  @property(Label) public aiStatusLabel: Label | null = null;
  @property(Label) public hintLabel: Label | null = null;
  @property(Label) public logLabel: Label | null = null;

  private approvalFill: BarFill | null = null;
  private potArea: Node | null = null;
  private actionButtons: { node: Node; graphics: Graphics; width: number; height: number }[] = [];
  private actionCountLabels: Label[] = [];
  private resultOverlay: Node | null = null;
  private openingOverlay: Node | null = null;

  private readonly BTN_NORMAL = new Color(38, 44, 54);
  private readonly BTN_DISABLED = new Color(75, 79, 86);
  private readonly BTN_HIGHLIGHT = new Color(220, 130, 40);
  private readonly BAR_WIDTH = 540;

  // —— 关卡配置（与 sim v5 LEVEL_5 同源）——
  private readonly duration = 90;
  private readonly initialApproval = 30;
  private readonly loseAt = 100;
  private readonly aiBaseRate = 1.0; // 每秒认可度涨幅
  private readonly addWorkCount = 4;
  private readonly changeReqCount = 3;
  private readonly blameCount = 2;
  private readonly addWorkSuppress = 3;
  private readonly changeReqSuppress = 2;
  private readonly addWorkDelta = -2;
  private readonly changeReqDelta = -5;
  private readonly blameHitDelta = -18;
  private readonly potIntervalMin = 10;
  private readonly potIntervalMax = 14;
  private readonly potWindow = 5;
  private readonly potFirstDelay = 6;
  private readonly potSizes: Record<PotSize, { prob: number; bite: number; label: string; color: Color; radius: number }> = {
    small: { prob: 0.45, bite: 5, label: '小插曲', color: new Color(232, 184, 64), radius: 30 },
    medium: { prob: 0.35, bite: 10, label: '客户投诉', color: new Color(230, 132, 52), radius: 42 },
    large: { prob: 0.2, bite: 28, label: '重大事故', color: new Color(218, 72, 62), radius: 56 },
  };

  // —— 局内状态 ——
  private time = 0;
  private approval = 30;
  private suppressUntil = 0;
  private addWorkLeft = 4;
  private changeReqLeft = 3;
  private blameLeft = 2;
  private pots: Pot[] = [];
  private selectedPotId = -1;
  private potIdSeq = 0;
  private nextPotTime = 6;
  private logs: string[] = [];
  private currentHint = '';
  private ended = false;
  private paused = true;
  private tickAccum = 0;

  public start() {
    this.buildGreyboxUI();
    this.resetGame();
    this.paused = true;
    this.showOpening();
    this.render();
  }

  public update(deltaTime: number) {
    if (this.ended || this.paused) return;
    // 0.5s 离散步进，和 sim 一致，数值行为可对照
    this.tickAccum += deltaTime;
    while (this.tickAccum >= 0.5) {
      this.tickAccum -= 0.5;
      this.step(0.5);
      if (this.ended) break;
    }
    this.render();
  }

  // ============================================================
  // 引擎
  // ============================================================

  private step(dt: number) {
    this.time += dt;

    if (this.time > this.suppressUntil) {
      this.approval = this.clamp(this.approval + this.aiBaseRate * dt, 0, this.loseAt);
    }

    if (this.time >= this.nextPotTime) {
      this.spawnPot();
      const gap = this.potIntervalMin + Math.random() * (this.potIntervalMax - this.potIntervalMin);
      this.nextPotTime = this.time + gap;
    }

    for (const p of this.pots) {
      if (p.resolved === null && this.time >= p.expireTime) {
        p.resolved = 'ai';
        const bite = this.potSizes[p.size].bite;
        this.approval = this.clamp(this.approval + bite, 0, this.loseAt);
        this.addLog(`AI 把「${this.potSizes[p.size].label}」圆过去了 +${bite}`);
      }
    }

    this.checkEnd();
  }

  private spawnPot() {
    const size = this.rollSize();
    const pot: Pot = {
      id: this.potIdSeq++,
      size,
      spawnTime: this.time,
      expireTime: this.time + this.potWindow,
      resolved: null,
    };
    this.pots.push(pot);
    this.selectedPotId = pot.id; // 默认选最新锅，玩家可改选
    this.addLog(`掉下一口「${this.potSizes[size].label}」（不甩 +${this.potSizes[size].bite}）`);
  }

  private rollSize(): PotSize {
    const r = Math.random();
    const { small, medium } = this.potSizes;
    if (r < small.prob) return 'small';
    if (r < small.prob + medium.prob) return 'medium';
    return 'large';
  }

  // ============================================================
  // 玩家动作
  // ============================================================

  public onAddWork() {
    if (this.ended || this.addWorkLeft <= 0) return;
    this.addWorkLeft -= 1;
    this.suppressUntil = Math.max(this.suppressUntil, this.time + this.addWorkSuppress);
    this.approval = this.clamp(this.approval + this.addWorkDelta, 0, this.loseAt);
    this.currentHint = '';
    this.addLog('你给 AI 加了需求，涨幅被压住几秒');
    this.checkEnd();
    this.render();
  }

  public onChangeReq() {
    if (this.ended || this.changeReqLeft <= 0) return;
    this.changeReqLeft -= 1;
    this.suppressUntil = Math.max(this.suppressUntil, this.time + this.changeReqSuppress);
    this.approval = this.clamp(this.approval + this.changeReqDelta, 0, this.loseAt);
    this.currentHint = '';
    this.addLog('你逼 AI 返工，认可度小降');
    this.checkEnd();
    this.render();
  }

  public onBlame() {
    if (this.ended || this.blameLeft <= 0) return;
    const pot = this.pots.find(
      (p) => p.id === this.selectedPotId && p.resolved === null && this.time < p.expireTime,
    );
    if (!pot) {
      this.currentHint = '先点一口锅选中，再甩锅扣给 AI';
      this.render();
      return;
    }
    this.blameLeft -= 1;
    pot.resolved = 'player';
    this.approval = this.clamp(this.approval + this.blameHitDelta, 0, this.loseAt);
    this.currentHint = '';
    this.addLog(`你把「${this.potSizes[pot.size].label}」甩给了 AI，认可度大降`);
    this.selectedPotId = -1;
    this.checkEnd();
    this.render();
  }

  private selectPot(id: number) {
    this.selectedPotId = id;
    this.render();
  }

  // ============================================================
  // 胜负 / 重开
  // ============================================================

  private checkEnd() {
    if (this.ended) return;
    if (this.approval >= this.loseAt) {
      this.finish(false, 'AI 转正了', '认可度涨满，老板让 AI 接管了你的岗位。');
    } else if (this.time >= this.duration) {
      this.finish(true, 'AI 未能转正', `你撑满了 ${this.duration} 秒，老板觉得 AI 还不能独立接管。`);
    }
  }

  private finish(win: boolean, title: string, copy: string) {
    this.ended = true;
    this.showResult(win, title, copy);
  }

  private resetGame() {
    this.time = 0;
    this.approval = this.initialApproval;
    this.suppressUntil = 0;
    this.addWorkLeft = this.addWorkCount;
    this.changeReqLeft = this.changeReqCount;
    this.blameLeft = this.blameCount;
    this.pots = [];
    this.selectedPotId = -1;
    this.potIdSeq = 0;
    this.nextPotTime = this.potFirstDelay;
    this.logs = ['老板让 AI 试着接管你的活，别让它得逞'];
    this.currentHint = '';
    this.ended = false;
    this.paused = false;
    this.tickAccum = 0;
    if (this.resultOverlay) {
      this.resultOverlay.destroy();
      this.resultOverlay = null;
    }
  }

  // ============================================================
  // 辅助
  // ============================================================

  private activePots(): Pot[] {
    return this.pots.filter((p) => p.resolved === null && this.time < p.expireTime);
  }

  private clamp(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v));
  }

  private addLog(msg: string) {
    this.logs.unshift(msg);
    this.logs = this.logs.slice(0, 4);
  }

  // ============================================================
  // 灰盒 UI（代码自绘）
  // ============================================================

  private buildGreyboxUI() {
    for (const child of [...this.node.children]) {
      if (child.name !== 'Camera') child.destroy();
    }
    this.actionButtons = [];
    this.actionCountLabels = [];

    const canvasSize = this.node.getComponent(UITransform)?.contentSize;
    const width = canvasSize?.width || 750;
    const height = canvasSize?.height || 1334;
    const top = height / 2;
    const left = -width / 2;

    this.createLabel(this.node, 'Title', '别让 AI 转正', 0, top - 54, 36, new Color(30, 34, 42), 460);
    this.bossStatusLabel = this.createLabel(this.node, 'BossStatus', '', 0, top - 104, 22, new Color(82, 89, 102), 560);

    this.createLabel(this.node, 'ApprovalText', 'AI 认可度（涨满 = AI 转正）', 0, top - 158, 22, new Color(45, 50, 60), 540);
    this.approvalLabel = this.createLabel(this.node, 'ApprovalValue', '', width / 2 - 80, top - 158, 26, new Color(45, 50, 60), 110);
    this.createBar(0, top - 200, this.BAR_WIDTH, 34, new Color(226, 232, 240), new Color(65, 131, 196));

    const aiPanel = this.createRect(this.node, 'AiDesk', 0, top - 290, width - 64, 92, new Color(238, 244, 249), new Color(205, 215, 225));
    this.createRect(aiPanel, 'AiAvatar', -260, 0, 70, 70, new Color(48, 61, 82), new Color(48, 61, 82));
    this.createLabel(aiPanel, 'AiFace', 'AI', -260, 0, 22, new Color(255, 255, 255), 64);
    this.aiStatusLabel = this.createLabel(aiPanel, 'AiStatus', '', 36, 16, 22, new Color(32, 38, 48), 440);
    this.createLabel(aiPanel, 'AiHint', 'AI 在干活，认可度每秒都在涨', 36, -20, 18, new Color(96, 105, 118), 460);

    this.hintLabel = this.createLabel(this.node, 'Hint', '', 0, top - 360, 22, new Color(200, 80, 60), width - 80);

    const potPanel = this.createRect(this.node, 'PotPanel', 0, top - 540, width - 64, 250, new Color(252, 245, 235), new Color(235, 215, 175));
    this.createLabel(potPanel, 'PotTitle', '外部麻烦（锅）：点锅选中 → 甩锅扣给 AI', 0, 100, 22, new Color(90, 65, 30), width - 100);
    this.potArea = new Node('PotArea');
    potPanel.addChild(this.potArea);
    const potTransform = this.potArea.addComponent(UITransform);
    potTransform.setContentSize(width - 100, 140);
    this.potArea.setPosition(new Vec3(0, -16, 0));

    const actions = [
      { name: '加需求', x: -222, handler: this.onAddWork },
      { name: '改需求', x: 0, handler: this.onChangeReq },
      { name: '甩锅', x: 222, handler: this.onBlame },
    ];
    actions.forEach((action) => {
      const button = this.createRect(this.node, `${action.name}Button`, action.x, top - 720, 200, 96, this.BTN_NORMAL, this.BTN_NORMAL);
      const graphics = button.getComponent(Graphics)!;
      this.createLabel(button, `${action.name}Label`, action.name, 0, 14, 26, new Color(255, 255, 255), 160);
      const countLabel = this.createLabel(button, `${action.name}Count`, '', 0, -22, 22, new Color(255, 214, 102), 80);
      this.actionCountLabels.push(countLabel);
      this.actionButtons.push({ node: button, graphics, width: 200, height: 96 });
      button.on(Node.EventType.TOUCH_END, action.handler, this);
    });

    const logPanel = this.createRect(this.node, 'LogPanel', 0, top - 870, width - 64, 150, new Color(245, 247, 250), new Color(214, 220, 228));
    this.createLabel(logPanel, 'LogTitle', '最新事件', 0, 48, 20, new Color(60, 65, 75), 420);
    this.logLabel = this.createLabel(logPanel, 'LogText', '', 0, -22, 18, new Color(60, 65, 75), width - 100);
    this.logLabel.lineHeight = 24;
  }

  private createBar(x: number, y: number, width: number, height: number, bg: Color, fill: Color) {
    const bar = this.createRect(this.node, 'ApprovalBar', x, y, width, height, bg, bg);
    const fillNode = this.createRect(bar, 'ApprovalBarFill', 0, 0, width, height, fill, fill);
    const transform = fillNode.getComponent(UITransform);
    const graphics = fillNode.getComponent(Graphics);
    if (!transform || !graphics) return;
    this.approvalFill = { node: fillNode, transform, graphics, color: fill, width, height };
  }

  private updateBar(ratio: number) {
    const fill = this.approvalFill;
    if (!fill) return;
    const w = Math.max(0, Math.min(fill.width, fill.width * ratio));
    fill.transform.setContentSize(w, fill.height);
    fill.node.setPosition(new Vec3(-fill.width / 2 + w / 2, 0, 0));
    this.drawRect(fill.graphics, w, fill.height, fill.color, fill.color);
  }

  private createRect(parent: Node, name: string, x: number, y: number, width: number, height: number, fill: Color, stroke?: Color) {
    const node = new Node(name);
    parent.addChild(node);
    node.setPosition(new Vec3(x, y, 0));
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    this.drawRect(graphics, width, height, fill, stroke);
    return node;
  }

  private drawRect(graphics: Graphics, width: number, height: number, fill: Color, stroke?: Color) {
    graphics.clear();
    graphics.lineWidth = stroke ? 2 : 0;
    graphics.fillColor = fill;
    if (stroke) graphics.strokeColor = stroke;
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
    if (stroke) graphics.stroke();
  }

  private createLabel(parent: Node, name: string, text: string, x: number, y: number, fontSize: number, color: Color, width: number) {
    const node = new Node(name);
    parent.addChild(node);
    node.setPosition(new Vec3(x, y, 0));
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, fontSize * 2.4);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.ceil(fontSize * 1.25);
    label.color = color;
    label.horizontalAlign = HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    return label;
  }

  // ============================================================
  // 开局引导 / 结果浮层
  // ============================================================

  private showOpening() {
    const canvasSize = this.node.getComponent(UITransform)?.contentSize;
    const width = canvasSize?.width || 750;
    const height = canvasSize?.height || 1334;

    const overlay = this.createRect(this.node, 'OpeningOverlay', 0, 0, width, height, new Color(20, 22, 28, 235), new Color(20, 22, 28, 235));
    this.createLabel(overlay, 'OpeningTitle', '怎么玩', 0, height / 2 - 110, 40, new Color(255, 255, 255), width - 80);

    const lines = [
      'AI 认可度涨满 = AI 转正，你输',
      '撑满 90 秒且没涨满 = 你赢',
      '',
      '平时点「加需求 / 改需求」压住涨幅',
      '',
      '屏幕会掉下「锅」（外部麻烦）：',
      '大锅不甩 AI 涨得多，小锅涨得少',
      '点锅选中 → 点「甩锅」扣给 AI → 大降',
      '',
      '⚠ 甩锅只有 2 次，救大放小，别浪费',
    ];
    lines.forEach((line, i) => {
      this.createLabel(overlay, `OpeningLine${i}`, line, 0, height / 2 - 190 - i * 34, 22, new Color(220, 225, 232), width - 80);
    });

    const btn = this.createRect(overlay, 'StartBtn', 0, -height / 2 + 110, 240, 80, new Color(65, 131, 196), new Color(65, 131, 196));
    this.createLabel(btn, 'StartLabel', '开始', 0, 0, 30, new Color(255, 255, 255), 220);
    btn.on(Node.EventType.TOUCH_END, () => {
      this.paused = false;
      overlay.destroy();
      this.openingOverlay = null;
    }, this);

    this.openingOverlay = overlay;
  }

  private showResult(win: boolean, title: string, copy: string) {
    const canvasSize = this.node.getComponent(UITransform)?.contentSize;
    const width = canvasSize?.width || 750;
    const height = canvasSize?.height || 1334;

    const overlay = this.createRect(this.node, 'ResultOverlay', 0, 0, width, height, new Color(20, 22, 28, 230), new Color(20, 22, 28, 230));
    const titleColor = win ? new Color(120, 200, 130) : new Color(230, 110, 90);
    this.createLabel(overlay, 'ResultTitle', title, 0, 90, 44, titleColor, width - 80);
    this.createLabel(overlay, 'ResultCopy', copy, 0, 10, 24, new Color(210, 215, 225), width - 120);

    const btn = this.createRect(overlay, 'RestartBtn', 0, -110, 240, 80, new Color(65, 131, 196), new Color(65, 131, 196));
    this.createLabel(btn, 'RestartLabel', '再来一局', 0, 0, 30, new Color(255, 255, 255), 220);
    btn.on(Node.EventType.TOUCH_END, () => this.resetGame(), this);

    this.resultOverlay = overlay;
  }

  // ============================================================
  // 渲染
  // ============================================================

  private render() {
    if (this.approvalLabel) this.approvalLabel.string = `${Math.round(this.approval)} / 100`;
    this.updateBar(this.approval / 100);

    if (this.bossStatusLabel) {
      this.bossStatusLabel.string = this.time > this.suppressUntil ? 'AI 在卖力干活' : 'AI 被你压住，涨得慢';
    }
    if (this.aiStatusLabel) {
      this.aiStatusLabel.string = this.time > this.suppressUntil ? '认可度持续上涨中' : '认可度被压制';
    }

    this.renderPots();

    if (this.actionCountLabels[0]) this.actionCountLabels[0].string = `${this.addWorkLeft}`;
    if (this.actionCountLabels[1]) this.actionCountLabels[1].string = `${this.changeReqLeft}`;
    if (this.actionCountLabels[2]) this.actionCountLabels[2].string = `${this.blameLeft}`;

    const hasSelectablePot = this.activePots().length > 0;
    const colors = [
      this.addWorkLeft > 0 ? this.BTN_NORMAL : this.BTN_DISABLED,
      this.changeReqLeft > 0 ? this.BTN_NORMAL : this.BTN_DISABLED,
      this.blameLeft > 0 && hasSelectablePot ? this.BTN_HIGHLIGHT : this.blameLeft > 0 ? this.BTN_NORMAL : this.BTN_DISABLED,
    ];
    this.actionButtons.forEach((b, i) => this.drawRect(b.graphics, b.width, b.height, colors[i], colors[i]));

    if (this.hintLabel) {
      if (this.ended || this.paused) {
        this.hintLabel.string = '';
      } else if (hasSelectablePot && this.blameLeft > 0) {
        this.hintLabel.string = '点锅选中 → 甩锅扣给 AI（救大放小）';
      } else {
        this.hintLabel.string = this.currentHint;
      }
    }
    if (this.logLabel) this.logLabel.string = this.logs.join('\n');
  }

  private renderPots() {
    if (!this.potArea) return;
    for (const c of [...this.potArea.children]) c.destroy();
    const active = this.activePots();
    if (active.length === 0) {
      this.createLabel(this.potArea, 'NoPot', '（暂无麻烦，AI 在安静干活）', 0, 0, 18, new Color(150, 135, 110), 460);
      return;
    }
    const spacing = 170;
    const startX = -((active.length - 1) * spacing) / 2;
    active.forEach((pot, i) => {
      const cfg = this.potSizes[pot.size];
      const x = startX + i * spacing;
      const potNode = new Node(`Pot${pot.id}`);
      this.potArea!.addChild(potNode);
      potNode.setPosition(new Vec3(x, 0, 0));
      const transform = potNode.addComponent(UITransform);
      transform.setContentSize(160, 150);
      const gfx = potNode.addComponent(Graphics);
      const selected = pot.id === this.selectedPotId;
      gfx.lineWidth = selected ? 6 : 0;
      gfx.fillColor = cfg.color;
      if (selected) gfx.strokeColor = new Color(255, 230, 110);
      gfx.circle(0, 24, cfg.radius);
      gfx.fill();
      if (selected) gfx.stroke();

      const labelSize = pot.size === 'large' ? 19 : pot.size === 'medium' ? 16 : 14;
      this.createLabel(potNode, `PotLabel${pot.id}`, cfg.label, 0, 24, labelSize, new Color(255, 255, 255), cfg.radius * 1.8);
      const left = Math.max(0, pot.expireTime - this.time);
      this.createLabel(potNode, `PotMeta${pot.id}`, `不甩 +${cfg.bite} · ${left.toFixed(1)}s`, 0, -52, 16, new Color(110, 80, 35), 160);

      potNode.on(Node.EventType.TOUCH_END, () => this.selectPot(pot.id), this);
    });
  }
}
