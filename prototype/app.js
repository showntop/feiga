const state = {
  time: 0,
  aiReputation: 80,
  suspicion: 0,
  selectedTaskId: "t0",
  bossCheckIn: 18,
  bossWarning: false,
  ended: false,
  actions: {
    addWork: 3,
    changeRequirement: 2,
    blame: 2,
  },
  tasks: [
    makeTask("t0", "老板汇报", 3, 32, 100),
    makeTask("t1", "客户回复", 2, 25, 70),
    makeTask("t2", "临时需求", 1, 22, 60),
  ],
  logs: ["老板标记了关键任务：老板汇报"],
};

function makeTask(id, name, importance, timeLeft, baseWork) {
  return {
    id,
    name,
    importance,
    timeLeft,
    initialTimeLimit: timeLeft,
    baseWork,
    progress: 0,
    pressure: 0,
    state: "normal",
    accidentUntil: 0,
    blamed: false,
    lastChangedAt: -999,
  };
}

const els = {
  repText: document.querySelector("#repText"),
  repBar: document.querySelector("#repBar"),
  susText: document.querySelector("#susText"),
  susBar: document.querySelector("#susBar"),
  bossPanel: document.querySelector("#bossPanel"),
  bossTitle: document.querySelector("#bossTitle"),
  bossCopy: document.querySelector("#bossCopy"),
  taskList: document.querySelector("#taskList"),
  foldedTasks: document.querySelector("#foldedTasks"),
  aiHead: document.querySelector("#aiHead"),
  aiScreen: document.querySelector("#aiScreen"),
  aiStatus: document.querySelector("#aiStatus"),
  aiTip: document.querySelector("#aiTip"),
  logList: document.querySelector("#logList"),
  resultModal: document.querySelector("#resultModal"),
  resultTitle: document.querySelector("#resultTitle"),
  resultCopy: document.querySelector("#resultCopy"),
  restartBtn: document.querySelector("#restartBtn"),
  addWorkBtn: document.querySelector("#addWorkBtn"),
  changeBtn: document.querySelector("#changeBtn"),
  blameBtn: document.querySelector("#blameBtn"),
  addWorkCount: document.querySelector("#addWorkCount"),
  changeCount: document.querySelector("#changeCount"),
  blameCount: document.querySelector("#blameCount"),
};

document.querySelectorAll(".action-btn").forEach((btn) => {
  btn.addEventListener("click", () => useAction(btn.dataset.action));
});
els.restartBtn.addEventListener("click", () => window.location.reload());

function activeTasks() {
  return state.tasks.filter((t) => ["normal", "urgent", "rework"].includes(t.state));
}

function currentTask() {
  const active = activeTasks();
  return active[0];
}

function selectedTask() {
  return state.tasks.find((t) => t.id === state.selectedTaskId) || currentTask();
}

function queueEfficiency(len) {
  if (len <= 2) return 1;
  if (len === 3) return 0.85;
  if (len === 4) return 0.7;
  return 0.55;
}

function pressureEfficiency(pressure) {
  return 1 - pressure / 200;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function addLog(message) {
  state.logs.unshift(message);
  state.logs = state.logs.slice(0, 3);
}

function hitAI(text) {
  els.aiScreen.textContent = text;
  els.aiHead.classList.remove("hit");
  void els.aiHead.offsetWidth;
  els.aiHead.classList.add("hit");
}

function useAction(action) {
  if (state.ended || state.actions[action] <= 0) return;

  const target = selectedTask();
  if (!target) return;

  state.actions[action] -= 1;

  if (action === "addWork") {
    const keyIndex = state.tasks.findIndex((t) => t.importance === 3);
    const task = makeTask(`tmp${Date.now()}`, "临时统计", 1, 18, 50);
    if (keyIndex >= 0) state.tasks.splice(keyIndex, 0, task);
    else state.tasks.push(task);
    state.tasks.forEach((t) => {
      if (["normal", "urgent", "rework"].includes(t.state)) {
        t.pressure = clamp(t.pressure + 5, 0, 100);
      }
    });
    state.suspicion = clamp(state.suspicion + (state.bossWarning ? 9 : 6), 0, 100);
    addLog("你塞入了一个临时统计，AI 队列变长。");
    hitAI("收到新任务");
  }

  if (action === "changeRequirement") {
    const valid = target.progress >= 40 && state.time - target.lastChangedAt >= 8;
    if (valid) {
      target.progress = clamp(target.progress - 20, 0, 100);
      target.pressure = clamp(target.pressure + 25, 0, 100);
      target.state = "rework";
      target.accidentUntil = state.time + 8;
      target.blamed = false;
      target.lastChangedAt = state.time;
      if (target.importance === 3) state.aiReputation = clamp(state.aiReputation - 4, 0, 100);
      state.suspicion = clamp(state.suspicion + (state.bossWarning ? 11 : 7), 0, 100);
      addLog(`你改口了「${target.name}」，AI 开始返工。`);
      hitAI("需求又变了");
    } else {
      state.suspicion = clamp(state.suspicion + 12, 0, 100);
      addLog("改口太早，老板觉得你在乱提需求。");
      hitAI("无法理解");
    }
  }

  if (action === "blame") {
    const accident = ["timeout", "rework", "lowQuality", "dropped"].includes(target.state);
    const valid = accident && !target.blamed && target.accidentUntil > state.time;
    if (valid) {
      const stateFactor = target.state === "rework" ? 0.5 : target.state === "lowQuality" ? 0.75 : 1;
      const damage = 12 * stateFactor * (target.importance / 3) * (target.importance === 3 ? 1.2 : 1);
      state.aiReputation = clamp(state.aiReputation - damage, 0, 100);
      state.suspicion = clamp(state.suspicion + 6, 0, 100);
      target.blamed = true;
      addLog(`甩锅成功：「${target.name}」让 AI 掉了信誉。`);
      hitAI("锅从天降");
    } else {
      state.suspicion = clamp(state.suspicion + 14, 0, 100);
      addLog("硬甩锅失败，老板开始怀疑你。");
      hitAI("证据不足");
    }
  }

  render();
  checkEnd();
}

function tick() {
  if (state.ended) return;
  state.time += 0.5;
  state.bossCheckIn -= 0.5;
  state.bossWarning = state.bossCheckIn <= 2 && state.bossCheckIn > 0;

  state.tasks = state.tasks.filter((t) => ["normal", "urgent", "rework"].includes(t.state) || t.accidentUntil > state.time);

  const cur = currentTask();
  if (cur) {
    const speed = cur.baseWork / (cur.initialTimeLimit * 0.65);
    cur.progress += speed * queueEfficiency(activeTasks().length) * pressureEfficiency(cur.pressure) * 0.5;
    cur.timeLeft -= 0.5;

    if (cur.progress >= 100) submitTask(cur);
    else if (cur.timeLeft <= 0) timeoutTask(cur);
    else if (cur.timeLeft <= 5 && cur.state === "normal") cur.state = "urgent";
  }

  if (activeTasks().length >= 5) {
    const victim = [...activeTasks()].sort((a, b) => a.importance - b.importance)[0];
    victim.state = "dropped";
    victim.accidentUntil = state.time + 8;
    victim.blamed = false;
    state.aiReputation = clamp(state.aiReputation - (victim.importance === 3 ? 8 : 1), 0, 100);
    addLog(`AI 放弃了「${victim.name}」。`);
  }

  if (state.bossCheckIn <= 0) {
    runBossCheck();
    state.bossCheckIn = 18;
  }

  render();
  checkEnd();
}

function submitTask(task) {
  if (task.pressure >= 61) {
    task.state = "lowQuality";
    task.accidentUntil = state.time + 8;
    task.blamed = false;
    if (task.importance === 3) state.aiReputation = clamp(state.aiReputation - 4, 0, 100);
    addLog(`「${task.name}」低质提交，出现锅点。`);
  } else {
    if (task.importance === 3) state.aiReputation = clamp(state.aiReputation + 6, 0, 100);
    state.tasks = state.tasks.filter((t) => t.id !== task.id);
    addLog(`AI 完成了「${task.name}」。`);
  }
}

function timeoutTask(task) {
  task.state = "timeout";
  task.accidentUntil = state.time + 8;
  task.blamed = false;
  state.aiReputation = clamp(state.aiReputation - (task.importance === 3 ? 8 : 1), 0, 100);
  addLog(`「${task.name}」超时，出现锅点。`);
}

function runBossCheck() {
  const key = state.tasks.find((t) => t.importance === 3);
  const cur = currentTask();
  const scope = [...new Set([key, cur].filter(Boolean))];
  scope.forEach((task) => {
    if (task.state === "normal" && task.progress >= 60) {
      state.aiReputation = clamp(state.aiReputation + 3, 0, 100);
    }
    if (["rework", "lowQuality"].includes(task.state)) {
      state.aiReputation = clamp(state.aiReputation - 2, 0, 100);
    }
    if (["timeout", "dropped"].includes(task.state)) {
      const damage = 3 * (task.importance / 3) + 12 * 0.25 * (task.importance / 3);
      state.aiReputation = clamp(state.aiReputation - damage, 0, 100);
    }
  });
  addLog("老板检查了当前任务。");
}

function checkEnd() {
  if (state.ended) return;
  if (state.aiReputation >= 100) return finish(false, "AI 转正", "老板觉得 AI 稳定、可靠、可以接管岗位。");
  if (state.suspicion >= 100) return finish(false, "你被抓包", "老板发现每次事故都和你有关。");
  if (state.time >= 100) {
    const threshold = 45 + (Math.random() * 2 - 1) * 6;
    return state.aiReputation < threshold
      ? finish(true, "AI 未能转正", "老板觉得 AI 很强，但现在还不能独立接管。")
      : finish(false, "AI 通过评审", "关键任务没有被你打出足够事故。");
  }
}

function finish(win, title, copy) {
  state.ended = true;
  els.resultTitle.textContent = title;
  els.resultCopy.textContent = copy;
  els.resultModal.classList.remove("hidden");
}

function render() {
  els.repText.textContent = Math.round(state.aiReputation);
  els.repBar.style.width = `${state.aiReputation}%`;
  els.susText.textContent = Math.round(state.suspicion);
  els.susBar.style.width = `${state.suspicion}%`;

  els.bossPanel.classList.toggle("warning", state.bossWarning);
  els.bossTitle.textContent = state.bossWarning ? "老板正在看队列" : "老板暂时没看这边";
  els.bossCopy.textContent = state.bossWarning ? "现在操作会更容易涨怀疑度。" : "等关键任务出问题后再甩锅。";

  const visible = state.tasks.slice(0, 3);
  els.taskList.innerHTML = visible.map(renderTask).join("");
  els.foldedTasks.textContent = state.tasks.length > 3 ? `还有 ${state.tasks.length - 3} 项待处理` : "";
  els.taskList.querySelectorAll(".task-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedTaskId = card.dataset.id;
      render();
    });
  });

  const cur = currentTask();
  els.aiStatus.textContent = cur ? `正在处理：${cur.name}` : "队列暂时清空";
  if (cur) {
    els.aiScreen.textContent = cur.state === "rework" ? "返工中" : cur.state === "urgent" ? "快超时" : "处理中";
    els.aiTip.textContent =
      ["timeout", "rework", "lowQuality", "dropped"].includes(cur.state) && cur.accidentUntil > state.time && !cur.blamed
        ? "出现锅点，可以甩锅"
        : cur.pressure >= 50
          ? "压力偏高，可能低质"
          : "等待事故窗口";
  } else {
    els.aiTip.textContent = "队列清空";
  }

  els.addWorkCount.textContent = state.actions.addWork;
  els.changeCount.textContent = state.actions.changeRequirement;
  els.blameCount.textContent = state.actions.blame;
  els.addWorkBtn.disabled = state.actions.addWork <= 0;
  els.changeBtn.disabled = state.actions.changeRequirement <= 0;
  els.blameBtn.disabled = state.actions.blame <= 0;

  els.logList.innerHTML = state.logs.map((log) => `<li>${log}</li>`).join("");
}

function renderTask(task) {
  const selected = task.id === state.selectedTaskId ? "selected" : "";
  const accident = ["timeout", "rework", "lowQuality", "dropped"].includes(task.state) ? "accident" : "";
  const stars = "★".repeat(task.importance);
  const stateText = {
    normal: "正常",
    urgent: "催促中",
    rework: "返工",
    timeout: "超时",
    lowQuality: "低质",
    dropped: "放弃",
    submitted: "完成",
  }[task.state];

  return `
    <article class="task-card ${selected} ${accident}" data-id="${task.id}">
      <div class="task-head">
        <span>${task.name}</span>
        <span class="stars">${stars}</span>
      </div>
      <div class="task-meta">
        <span>进度 ${Math.round(task.progress)}%</span>
        <span>${Math.max(0, Math.ceil(task.timeLeft))}s</span>
      </div>
      <div class="mini-track"><div class="mini-fill" style="width:${clamp(task.progress, 0, 100)}%"></div></div>
      <div class="task-state">${stateText} · 压力 ${Math.round(task.pressure)}</div>
    </article>
  `;
}

render();
setInterval(tick, 500);
