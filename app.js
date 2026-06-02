const form = document.querySelector("#process-form");
const processTable = document.querySelector("#process-table");
const resultTable = document.querySelector("#result-table");
const processCount = document.querySelector("#process-count");
const ganttChart = document.querySelector("#gantt-chart");
const stepCharts = document.querySelector("#step-charts");
const metricsBox = document.querySelector("#metrics");
const timelineRange = document.querySelector("#timeline-range");
const algorithmInput = document.querySelector("#algorithm");
const quantumInput = document.querySelector("#quantum");
const algorithmInfo = document.querySelector("#algorithm-info");
const themeToggle = document.querySelector("#theme-toggle");

let processes = [];

const colors = ["#57534e", "#78716c", "#a16207", "#ca8a04", "#eab308", "#854d0e", "#44403c", "#d97706"];

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const process = {
    id: document.querySelector("#pid").value.trim(),
    arrival: Number(document.querySelector("#arrival").value),
    burst: Number(document.querySelector("#burst").value),
    priority: document.querySelector("#priority").value === "" ? null : Number(document.querySelector("#priority").value),
  };

  if (!process.id || process.arrival < 0 || process.burst <= 0) return;
  if (processes.some((item) => item.id.toLowerCase() === process.id.toLowerCase())) {
    alert("Process ID must be unique.");
    return;
  }

  processes.push(process);
  form.reset();
  renderProcesses();
});

document.querySelector("#simulate").addEventListener("click", runSimulation);
algorithmInput.addEventListener("change", renderAlgorithmInfo);
quantumInput.addEventListener("input", renderAlgorithmInfo);
themeToggle.addEventListener("click", toggleTheme);
document.querySelector("#clear").addEventListener("click", () => {
  processes = [];
  renderProcesses();
  renderEmptyResults();
});

document.querySelector("#sample").addEventListener("click", () => {
  processes = [
    { id: "P1", arrival: 0, burst: 7, priority: 2 },
    { id: "P2", arrival: 2, burst: 4, priority: 1 },
    { id: "P3", arrival: 4, burst: 1, priority: 4 },
    { id: "P4", arrival: 5, burst: 4, priority: 3 },
  ];
  renderProcesses();
  runSimulation();
});

function renderProcesses() {
  processCount.textContent = `${processes.length} ${processes.length === 1 ? "process" : "processes"}`;
  processTable.innerHTML = "";

  if (processes.length === 0) {
    processTable.innerHTML = `<tr><td colspan="5" class="empty-state">No processes added.</td></tr>`;
    return;
  }

  processes.forEach((process, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(process.id)}</td>
      <td>${process.arrival}</td>
      <td>${process.burst}</td>
      <td>${process.priority ?? "-"}</td>
      <td><button class="delete-btn" type="button" data-index="${index}">Remove</button></td>
    `;
    processTable.appendChild(row);
  });

  document.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", () => {
      processes.splice(Number(button.dataset.index), 1);
      renderProcesses();
    });
  });
}

function runSimulation() {
  if (processes.length === 0) {
    renderEmptyResults("Add at least one process to simulate.");
    return;
  }

  const algorithm = algorithmInput.value;
  const quantum = Number(quantumInput.value);
  if (algorithm === "rr" && quantum <= 0) {
    alert("Round Robin needs a quantum greater than 0.");
    return;
  }

  const result = simulate(processes, algorithm, quantum);
  renderGantt(result.timeline);
  renderStepCharts(result.timeline, result.algorithm, result.quantum, result.jobs);
  renderResults(result);
}

function simulate(sourceProcesses, algorithm, quantum) {
  const jobs = sourceProcesses
    .map((process, index) => ({
      ...process,
      index,
      remaining: process.burst,
      completion: 0,
      firstStart: null,
    }))
    .sort((a, b) => a.arrival - b.arrival || a.index - b.index);

  const timeline = [];
  let time = 0;
  let completed = 0;

  const appendSlice = (id, start, end) => {
    if (start === end) return;
    const previous = timeline[timeline.length - 1];
    if (previous && previous.id === id && previous.end === start) {
      previous.end = end;
    } else {
      timeline.push({ id, start, end });
    }
  };

  const readySnapshot = (atTime) =>
    jobs
      .filter((job) => job.arrival <= atTime && job.remaining > 0)
      .map((job) => ({
        id: job.id,
        arrival: job.arrival,
        burst: job.burst,
        remaining: job.remaining,
        priority: job.priority,
        waiting: atTime - job.arrival,
        ratio: responseRatio(job, atTime),
      }));

  const addSlice = (id, start, end, detail = {}) => {
    const beforeLength = timeline.length;
    appendSlice(id, start, end);
    const target = timeline.length === beforeLength ? timeline[timeline.length - 1] : timeline[timeline.length - 1];
    target.steps = target.steps ?? [];
    target.steps.push({ id, start, end, ...detail });
  };

  if (algorithm === "rr") {
    simulateRoundRobin(jobs, timeline, addSlice, quantum, time);
  } else {
    while (completed < jobs.length) {
      const available = jobs.filter((job) => job.arrival <= time && job.remaining > 0);
      if (available.length === 0) {
        const nextArrival = Math.min(...jobs.filter((job) => job.remaining > 0).map((job) => job.arrival));
        addSlice("Idle", time, nextArrival, {
          ready: [],
          reason: "No process has arrived, so the CPU waits for the next arrival.",
        });
        time = nextArrival;
        continue;
      }

      const ready = readySnapshot(time);
      const current = pickProcess(available, algorithm, time);
      if (current.firstStart === null) current.firstStart = time;

      if (algorithm === "srtf") {
        const nextArrival = nextArrivalBeforeFinish(jobs, current, time);
        const runFor = Math.min(current.remaining, nextArrival === null ? current.remaining : nextArrival - time);
        addSlice(current.id, time, time + runFor, {
          ready,
          selected: snapshotJob(current, time),
          reason: reasonForChoice(current, ready, algorithm, time, runFor),
        });
        current.remaining -= runFor;
        time += runFor;
      } else {
        addSlice(current.id, time, time + current.remaining, {
          ready,
          selected: snapshotJob(current, time),
          reason: reasonForChoice(current, ready, algorithm, time, current.remaining),
        });
        time += current.remaining;
        current.remaining = 0;
      }

      if (current.remaining === 0) {
        current.completion = time;
        completed += 1;
      }
    }
  }

  const finalJobs = jobs.map((job) => ({
    ...job,
    turnaround: job.completion - job.arrival,
    waiting: job.completion - job.arrival - job.burst,
    response: job.firstStart - job.arrival,
  }));
  const totalBurst = finalJobs.reduce((sum, job) => sum + job.burst, 0);
  const start = timeline[0]?.start ?? 0;
  const end = timeline[timeline.length - 1]?.end ?? 0;
  const elapsed = Math.max(1, end - start);

  return {
    jobs: finalJobs.sort((a, b) => a.index - b.index),
    timeline,
    algorithm,
    quantum,
    averageTat: average(finalJobs.map((job) => job.turnaround)),
    averageWt: average(finalJobs.map((job) => job.waiting)),
    averageRt: average(finalJobs.map((job) => job.response)),
    cpuUtilization: (totalBurst / elapsed) * 100,
    throughput: finalJobs.length / elapsed,
    start,
    end,
  };
}

function simulateRoundRobin(jobs, timeline, addSlice, quantum, startTime) {
  const queue = [];
  const queued = new Set();
  let time = startTime;
  let completed = 0;

  const enqueueArrived = () => {
    jobs.forEach((job) => {
      if (job.arrival <= time && job.remaining > 0 && !queued.has(job.index)) {
        queue.push(job);
        queued.add(job.index);
      }
    });
  };

  const readySnapshot = () =>
    queue.map((job) => ({
      id: job.id,
      arrival: job.arrival,
      burst: job.burst,
      remaining: job.remaining,
      priority: job.priority,
      waiting: time - job.arrival,
      ratio: responseRatio(job, time),
    }));

  while (completed < jobs.length) {
    enqueueArrived();
    if (queue.length === 0) {
      const nextArrival = Math.min(...jobs.filter((job) => job.remaining > 0).map((job) => job.arrival));
      addSlice("Idle", time, nextArrival, {
        ready: [],
        reason: "The ready queue is empty, so the CPU remains idle until the next process arrives.",
      });
      time = nextArrival;
      enqueueArrived();
    }

    const ready = readySnapshot();
    const current = queue.shift();
    if (current.firstStart === null) current.firstStart = time;

    const runFor = Math.min(quantum, current.remaining);
    addSlice(current.id, time, time + runFor, {
      ready,
      selected: snapshotJob(current, time),
      reason: reasonForChoice(current, ready, "rr", time, runFor, quantum),
    });
    time += runFor;
    current.remaining -= runFor;
    enqueueArrived();

    if (current.remaining > 0) {
      queue.push(current);
    } else {
      queued.delete(current.index);
      current.completion = time;
      completed += 1;
    }
  }
}

function pickProcess(available, algorithm, time) {
  const sorted = [...available];
  if (algorithm === "sjf" || algorithm === "srtf") {
    sorted.sort((a, b) => a.remaining - b.remaining || a.arrival - b.arrival || a.index - b.index);
  } else if (algorithm === "priority") {
    sorted.sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER) || a.arrival - b.arrival || a.index - b.index);
  } else if (algorithm === "hrrn") {
    sorted.sort((a, b) => responseRatio(b, time) - responseRatio(a, time) || a.arrival - b.arrival || a.index - b.index);
  } else {
    sorted.sort((a, b) => a.arrival - b.arrival || a.index - b.index);
  }
  return sorted[0];
}

function snapshotJob(job, time) {
  return {
    id: job.id,
    arrival: job.arrival,
    burst: job.burst,
    remaining: job.remaining,
    priority: job.priority,
    waiting: time - job.arrival,
    ratio: responseRatio(job, time),
  };
}

function reasonForChoice(current, ready, algorithm, time, runFor, quantum = null) {
  const candidates = readyText(ready);
  if (algorithm === "fcfs") {
    return `At time ${time}, the ready queue is ${candidates}. FCFS compares arrival order, so ${current.id} is selected because it arrived earliest among the ready processes. Since FCFS is non-preemptive, it keeps the CPU for ${runFor} time unit${runFor === 1 ? "" : "s"}.`;
  }
  if (algorithm === "sjf") {
    return `At time ${time}, the ready queue is ${candidates}. SJF compares burst time and chooses the shortest job. ${current.id} has burst time ${current.burst}, so it runs to completion for ${runFor} time unit${runFor === 1 ? "" : "s"}.`;
  }
  if (algorithm === "srtf") {
    return `At time ${time}, the ready queue is ${candidates}. SRTF compares remaining time after every arrival. ${current.id} has the shortest remaining time (${current.remaining}), so it runs for ${runFor} time unit${runFor === 1 ? "" : "s"} before the next decision point.`;
  }
  if (algorithm === "priority") {
    return `At time ${time}, the ready queue is ${candidates}. Priority Scheduling chooses the smallest priority number as the highest priority. ${current.id} has priority ${current.priority ?? "not set"}, so it is selected and runs non-preemptively for ${runFor} time unit${runFor === 1 ? "" : "s"}.`;
  }
  if (algorithm === "rr") {
    return `At time ${time}, the ready queue is ${candidates}. Round Robin selects the front process, ${current.id}. It can run for at most the time quantum (${quantum}), so this slice lasts ${runFor} time unit${runFor === 1 ? "" : "s"}. If work remains, it moves to the back of the queue.`;
  }
  if (algorithm === "hrrn") {
    return `At time ${time}, the ready queue is ${candidates}. HRRN calculates response ratio = (waiting time + burst time) / burst time. ${current.id} has the highest ratio (${responseRatio(current, time).toFixed(2)}), so it runs to completion for ${runFor} time unit${runFor === 1 ? "" : "s"}.`;
  }
  return `${current.id} is selected from ${candidates} and runs for ${runFor} time unit${runFor === 1 ? "" : "s"}.`;
}

function readyText(ready) {
  if (!ready || ready.length === 0) return "empty";
  return ready
    .map((job) => {
      const priority = job.priority === null || job.priority === undefined ? "" : `, priority ${job.priority}`;
      return `${job.id} (arrival ${job.arrival}, burst ${job.burst}, remaining ${job.remaining}${priority})`;
    })
    .join("; ");
}

function nextArrivalBeforeFinish(jobs, current, time) {
  const finishTime = time + current.remaining;
  const arrivals = jobs
    .filter((job) => job.remaining > 0 && job.arrival > time && job.arrival < finishTime)
    .map((job) => job.arrival);
  return arrivals.length ? Math.min(...arrivals) : null;
}

function responseRatio(job, time) {
  const waiting = time - job.arrival;
  return (waiting + job.burst) / job.burst;
}

function renderGantt(timeline) {
  ganttChart.innerHTML = "";
  if (timeline.length === 0) {
    ganttChart.innerHTML = `<div class="empty-state">No timeline available.</div>`;
    return;
  }

  ganttChart.appendChild(createTimeline(timeline));
}

function renderStepCharts(timeline, algorithm, quantum) {
  stepCharts.innerHTML = "";
  if (timeline.length === 0) {
    stepCharts.innerHTML = `<div class="empty-state">Run a simulation to see each scheduling step.</div>`;
    return;
  }

  timeline.forEach((slice, index) => {
    const step = document.createElement("article");
    step.className = "step-card";
    step.innerHTML = `
      <div class="step-copy">
        <strong>Step ${index + 1}</strong>
        <p>${explainStep(slice, algorithm, quantum)}</p>
      </div>
      <div class="mini-gantt"></div>
    `;
    step.querySelector(".mini-gantt").appendChild(createTimeline(timeline.slice(0, index + 1)));
    stepCharts.appendChild(step);
  });
}

function createTimeline(timeline) {
  const total = timeline[timeline.length - 1].end - timeline[0].start;
  const wrapper = document.createElement("div");
  wrapper.className = "timeline";
  timeline.forEach((slice) => {
    const block = document.createElement("div");
    const width = Math.max(10, ((slice.end - slice.start) / total) * 100);
    block.className = `slice ${slice.id === "Idle" ? "idle" : ""}`;
    block.style.width = `${width}%`;
    block.style.background = slice.id === "Idle" ? "var(--idle)" : colorFor(slice.id);
    block.innerHTML = `
      <div class="slice-label">${escapeHtml(slice.id)}</div>
      <div class="slice-time"><span>${slice.start}</span><span>${slice.end}</span></div>
    `;
    return wrapper.appendChild(block);
  });
  return wrapper;
}

function explainStep(slice, algorithm, quantum) {
  const details = slice.steps?.map((step) => step.reason).filter(Boolean) ?? [];
  if (details.length > 0) {
    return `${details.join(" ")} The Gantt chart now covers time ${slice.start} to ${slice.end} for this block.`;
  }

  if (slice.id === "Idle") return `CPU is idle from time ${slice.start} to ${slice.end} because no process is ready.`;
  return `${slice.id} executes from time ${slice.start} to ${slice.end} under ${algorithm.toUpperCase()}${algorithm === "rr" ? ` with quantum ${quantum}` : ""}.`;
}

function renderResults(result) {
  timelineRange.textContent = `Time ${result.start} to ${result.end}`;
  resultTable.innerHTML = "";
  result.jobs.forEach((job) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(job.id)}</td>
      <td>${job.completion}</td>
      <td>${job.turnaround}</td>
      <td>${job.waiting}</td>
      <td>${job.response}</td>
    `;
    resultTable.appendChild(row);
  });

  metricsBox.innerHTML = `
    ${metric("Average TAT", result.averageTat.toFixed(2))}
    ${metric("Average WT", result.averageWt.toFixed(2))}
    ${metric("Average RT", result.averageRt.toFixed(2))}
    ${metric("CPU Utilization", `${result.cpuUtilization.toFixed(2)}%`)}
    ${metric("Throughput", `${result.throughput.toFixed(3)} / time unit`)}
  `;
}

function renderAlgorithmInfo() {
  const algorithm = algorithmInput.value;
  const content = {
    fcfs: {
      title: "First Come, First Served (FCFS)",
      body: "FCFS is a non-preemptive algorithm. Processes are executed in the order they arrive in the ready queue. Once a process starts, it keeps the CPU until its burst time is finished.",
      rule: "Selection rule: earliest arrival time wins. Ties keep the input order.",
    },
    sjf: {
      title: "Shortest Job First (SJF)",
      body: "SJF is a non-preemptive algorithm. At each CPU decision point, it looks at all arrived processes and chooses the one with the smallest burst time.",
      rule: "Selection rule: smallest burst time wins. The chosen process runs to completion.",
    },
    srtf: {
      title: "Shortest Remaining Time First (SRTF)",
      body: "SRTF is the preemptive version of SJF. Whenever a new process arrives, the scheduler compares remaining times and may switch to the process with less work left.",
      rule: "Selection rule: smallest remaining time wins at every decision point.",
    },
    priority: {
      title: "Priority Scheduling",
      body: "Priority Scheduling chooses the ready process with the highest priority. In this simulator, a smaller priority number means higher priority.",
      rule: "Selection rule: lowest priority number wins. This implementation is non-preemptive.",
    },
    rr: {
      title: "Round Robin",
      body: "Round Robin is preemptive and fair. Processes wait in a circular ready queue, and each process receives the CPU for one time quantum at a time.",
      rule: `Selection rule: front of queue runs for up to quantum ${Number(quantumInput.value) || 1}; unfinished processes return to the back.`,
    },
    hrrn: {
      title: "Highest Response Ratio Next (HRRN)",
      body: "HRRN is non-preemptive and balances short jobs with aging. A process gets more attractive the longer it waits, reducing starvation.",
      rule: "Selection rule: highest response ratio wins, where response ratio = (waiting time + burst time) / burst time.",
    },
  }[algorithm];

  algorithmInfo.innerHTML = `
    <div>
      <h2>${content.title}</h2>
      <p>${content.body}</p>
    </div>
    <strong>${content.rule}</strong>
  `;
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("dark-mode", isDark);
  themeToggle.textContent = isDark ? "Light" : "Dark";
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  localStorage.setItem("cpu-scheduler-theme", theme);
}

function toggleTheme() {
  applyTheme(document.body.classList.contains("dark-mode") ? "light" : "dark");
}

function renderEmptyResults(message = "Run a simulation to see results.") {
  timelineRange.textContent = "No simulation yet";
  ganttChart.innerHTML = `<div class="empty-state">${message}</div>`;
  stepCharts.innerHTML = `<div class="empty-state">${message}</div>`;
  resultTable.innerHTML = `<tr><td colspan="5" class="empty-state">${message}</td></tr>`;
  metricsBox.innerHTML = `<div class="empty-state">${message}</div>`;
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function colorFor(id) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash += id.charCodeAt(index);
  return colors[hash % colors.length];
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

renderProcesses();
renderEmptyResults();
renderAlgorithmInfo();
applyTheme(localStorage.getItem("cpu-scheduler-theme") || "light");
