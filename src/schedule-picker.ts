import { getLocale, msg } from "./i18n";

type CalendarDay = {
  date: Date;
  key: string;
  outside: boolean;
};

export type SchedulePicker = {
  getDate(): Date;
  isValid(): boolean;
  open(): void;
  focus(): void;
  destroy(): void;
};

const pad = (value: number) => String(value).padStart(2, "0");

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function icon(pathData: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

export function initializeSchedulePicker(
  root: HTMLElement,
  onChange: (valid: boolean) => void,
  clockTypeLabel: () => string,
): SchedulePicker {
  const now = new Date();
  now.setSeconds(0, 0);
  let currentTime = now;
  let selected = new Date(now.getTime() + 5 * 60_000);
  let month = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const presets = [
    { label: "morning", hour: 9 },
    { label: "afternoon", hour: 13 },
    { label: "evening", hour: 18 },
  ] as const;

  function isValid(): boolean {
    return selected.getTime() > Date.now();
  }

  function createButton(
    label: string,
    className: string,
    focusKey: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.focusKey = focusKey;
    button.setAttribute("aria-label", label);
    return button;
  }

  function calendarDays(): CalendarDay[] {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const count = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
    ).getDate();
    const cellCount = Math.ceil((offset + count) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => {
      const date = new Date(
        month.getFullYear(),
        month.getMonth(),
        index - offset + 1,
      );
      return {
        date,
        key: dayKey(date),
        outside: date.getMonth() !== month.getMonth(),
      };
    });
  }

  function render(focusKey?: string): void {
    const locale = getLocale();
    const selectedDay = dayKey(selected);
    const today = dayKey(currentTime);
    const monthLabel = month.toLocaleDateString(locale, {
      month: "long",
      year: "numeric",
    });
    const days = calendarDays();
    const tabDay =
      days.find((day) => day.key === selectedDay)?.key ??
      days.find((day) => !day.outside && day.key >= today)?.key;

    root.setAttribute("aria-label", msg("chooseDateAndTime"));
    root.replaceChildren();

    const dateSection = document.createElement("section");
    dateSection.className = "schedule-date-section";
    dateSection.setAttribute("aria-label", msg("selectDate"));

    const weekdayShortcuts = document.createElement("div");
    weekdayShortcuts.className = "schedule-weekday-shortcuts";
    weekdayShortcuts.setAttribute("role", "group");
    weekdayShortcuts.setAttribute("aria-label", msg("chooseWeekdayForPost"));
    const weekdays = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(
        currentTime.getFullYear(),
        currentTime.getMonth(),
        currentTime.getDate() +
          ((index - currentTime.getDay() + 7) % 7),
        selected.getHours(),
        selected.getMinutes(),
      );
      if (date.getTime() <= currentTime.getTime()) date.setDate(date.getDate() + 7);
      return date;
    });
    weekdays.forEach((date, index) => {
      const button = createButton(
        date.toLocaleDateString(locale, {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        "schedule-weekday",
        `weekday-${index}`,
      );
      button.textContent = date.toLocaleDateString(locale, {
        weekday: "narrow",
      });
      const chosen = date.getDay() === selected.getDay();
      button.classList.toggle("chosen", chosen);
      button.setAttribute("aria-pressed", String(chosen));
      button.title = date.toLocaleDateString(locale, {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      button.addEventListener("click", () => selectDay(date, `weekday-${index}`));
      weekdayShortcuts.append(button);
    });

    const monthNavigation = document.createElement("div");
    monthNavigation.className = "schedule-month-navigation";
    const previousMonth = createButton(
      msg("previousMonth"),
      "schedule-month-button",
      "previous-month",
    );
    previousMonth.append(icon("m14 6-6 6 6 6"));
    previousMonth.disabled =
      month.getFullYear() * 12 + month.getMonth() <=
      currentTime.getFullYear() * 12 + currentTime.getMonth();
    previousMonth.addEventListener("click", () => changeMonth(-1));
    const monthHeading = document.createElement("h4");
    monthHeading.textContent = monthLabel;
    monthHeading.setAttribute("aria-live", "polite");
    const nextMonth = createButton(
      msg("nextMonth"),
      "schedule-month-button",
      "next-month",
    );
    nextMonth.append(icon("m10 6 6 6-6 6"));
    nextMonth.addEventListener("click", () => changeMonth(1));
    monthNavigation.append(previousMonth, monthHeading, nextMonth);

    const weekdayLabels = document.createElement("div");
    weekdayLabels.className = "schedule-weekday-labels";
    weekdayLabels.setAttribute("aria-hidden", "true");
    Array.from({ length: 7 }, (_, index) => {
      const date = new Date(2024, 0, index + 1);
      const label = document.createElement("span");
      label.textContent = date.toLocaleDateString(locale, {
        weekday: "narrow",
      });
      weekdayLabels.append(label);
    });

    const calendar = document.createElement("div");
    calendar.className = "schedule-calendar";
    calendar.setAttribute("role", "group");
    calendar.setAttribute("aria-label", monthLabel);
    days.forEach((day) => {
      const label = day.date.toLocaleDateString(locale, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const button = createButton(
        label,
        "schedule-calendar-day",
        `date-${day.key}`,
      );
      button.textContent = String(day.date.getDate());
      button.classList.toggle("outside", day.outside);
      button.classList.toggle("selected", day.key === selectedDay);
      button.classList.toggle("today", day.key === today);
      button.disabled = day.key < today;
      button.tabIndex = day.key === tabDay ? 0 : -1;
      button.setAttribute("aria-pressed", String(day.key === selectedDay));
      if (day.key === today) button.setAttribute("aria-current", "date");
      button.addEventListener("click", () =>
        selectDay(day.date, `date-${day.key}`),
      );
      button.addEventListener("keydown", (event) => moveDay(event, day.date));
      calendar.append(button);
    });
    dateSection.append(
      weekdayShortcuts,
      monthNavigation,
      weekdayLabels,
      calendar,
    );

    const timeSection = document.createElement("section");
    timeSection.className = "schedule-time-section";
    timeSection.setAttribute("aria-label", msg("selectTime"));
    const timeHeading = document.createElement("div");
    timeHeading.className = "schedule-time-heading";
    const timeTitle = document.createElement("h4");
    timeTitle.textContent = msg("selectTime");
    const clockType = document.createElement("span");
    clockType.textContent = clockTypeLabel();
    timeHeading.append(timeTitle, clockType);

    const timeControls = document.createElement("div");
    timeControls.className = "schedule-time-controls";
    appendTimeUnit(
      timeControls,
      "hour",
      selected.getHours(),
      selected.getMinutes(),
    );
    const colon = document.createElement("span");
    colon.className = "schedule-time-colon";
    colon.setAttribute("aria-hidden", "true");
    colon.textContent = ":";
    timeControls.append(colon);
    appendTimeUnit(
      timeControls,
      "minute",
      selected.getHours(),
      selected.getMinutes(),
    );

    const presetRow = document.createElement("div");
    presetRow.className = "schedule-time-presets";
    presets.forEach((preset) => {
      const button = createButton(
        msg(preset.label),
        "schedule-time-preset",
        `preset-${preset.label}`,
      );
      const presetTime = document.createElement("strong");
      presetTime.textContent = `${pad(preset.hour)}:00`;
      const label = document.createElement("span");
      label.textContent = msg(preset.label);
      button.replaceChildren(label, presetTime);
      button.disabled = presetIsPast(preset.hour);
      button.classList.toggle(
        "chosen",
        selected.getHours() === preset.hour && selected.getMinutes() === 0,
      );
      button.addEventListener("click", () =>
        setTime(preset.hour, 0, `preset-${preset.label}`),
      );
      presetRow.append(button);
    });
    timeSection.append(timeHeading, timeControls, presetRow);

    const summary = document.createElement("div");
    summary.className = "schedule-selection-summary";
    summary.setAttribute("aria-live", "polite");
    summary.append(icon("M8 3v4m8-4v4M4 10h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"));
    const summaryDate = document.createElement("span");
    summaryDate.textContent = selected.toLocaleDateString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const summaryTime = document.createElement("strong");
    summaryTime.textContent = `${pad(selected.getHours())}:${pad(selected.getMinutes())}`;
    summary.append(summaryDate, summaryTime);

    const validation = document.createElement("p");
    validation.className = "schedule-validation";
    validation.setAttribute("role", "status");
    validation.textContent = isValid() ? "" : msg("futureDateRequired");
    root.append(dateSection, timeSection, summary, validation);
    onChange(isValid());
    if (focusKey) {
      Array.from(root.querySelectorAll<HTMLElement>("[data-focus-key]"))
        .find((element) => element.dataset.focusKey === focusKey)
        ?.focus();
    }

    function appendTimeUnit(
      container: HTMLElement,
      part: "hour" | "minute",
      hour: number,
      minute: number,
    ): void {
      const unit = document.createElement("div");
      unit.className = "schedule-time-unit";
      const label = msg(part);
      const up = createButton(
        msg(part === "hour" ? "increaseHour" : "increaseMinute"),
        "schedule-time-step",
        `${part}-up`,
      );
      up.append(icon("m6 15 6-6 6 6"));
      up.addEventListener("click", () => stepTime(part, 1));
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.maxLength = 2;
      input.value = pad(part === "hour" ? hour : minute);
      input.setAttribute("aria-label", label);
      input.dataset.focusKey = `${part}-input`;
      input.addEventListener("focus", () => input.select());
      input.addEventListener("change", (event) => inputTime(event, part));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          stepTime(part, event.key === "ArrowUp" ? 1 : -1);
        }
      });
      const down = createButton(
        msg(part === "hour" ? "decreaseHour" : "decreaseMinute"),
        "schedule-time-step",
        `${part}-down`,
      );
      down.append(icon("m6 9 6 6 6-6"));
      down.addEventListener("click", () => stepTime(part, -1));
      const unitLabel = document.createElement("span");
      unitLabel.textContent = label;
      unit.append(up, input, down, unitLabel);
      container.append(unit);
    }
  }

  function selectDay(date: Date, focusKey?: string): void {
    selected = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      selected.getHours(),
      selected.getMinutes(),
    );
    selected.setSeconds(0, 0);
    currentTime = new Date();
    month = new Date(selected.getFullYear(), selected.getMonth(), 1);
    render(focusKey);
  }

  function changeMonth(offset: number): void {
    month = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    render(offset < 0 ? "previous-month" : "next-month");
  }

  function setTime(hour: number, minute: number, focusKey?: string): void {
    selected = new Date(selected);
    selected.setHours(hour, minute, 0, 0);
    currentTime = new Date();
    render(focusKey);
  }

  function stepTime(part: "hour" | "minute", direction: number): void {
    const hour = selected.getHours();
    const minute = selected.getMinutes();
    setTime(
      part === "hour" ? (hour + direction + 24) % 24 : hour,
      part === "minute" ? (minute + direction + 60) % 60 : minute,
      `${part}-${direction > 0 ? "up" : "down"}`,
    );
  }

  function inputTime(event: Event, part: "hour" | "minute"): void {
    const input = event.currentTarget as HTMLInputElement;
    const value = Number(input.value);
    const maximum = part === "hour" ? 23 : 59;
    if (!/^\d{1,2}$/.test(input.value) || value > maximum) {
      render(`${part}-input`);
      return;
    }
    setTime(
      part === "hour" ? value : selected.getHours(),
      part === "minute" ? value : selected.getMinutes(),
      `${part}-input`,
    );
  }

  function presetIsPast(hour: number): boolean {
    const date = new Date(selected);
    date.setHours(hour, 0, 0, 0);
    return date.getTime() <= currentTime.getTime();
  }

  function moveDay(event: KeyboardEvent, day: Date): void {
    const next = new Date(day);
    const horizontal = getLocale() === "ar" ? -1 : 1;
    const shifts: Record<string, number> = {
      ArrowLeft: -horizontal,
      ArrowRight: horizontal,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -((day.getDay() + 6) % 7),
      End: 6 - ((day.getDay() + 6) % 7),
    };
    if (event.key === "PageUp" || event.key === "PageDown") {
      const date = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + (event.key === "PageUp" ? -1 : 1));
      next.setDate(
        Math.min(date, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()),
      );
    } else if (event.key in shifts) {
      next.setDate(next.getDate() + shifts[event.key]);
    } else {
      return;
    }
    event.preventDefault();
    if (dayKey(next) < dayKey(currentTime)) next.setTime(currentTime.getTime());
    selectDay(next, `date-${dayKey(next)}`);
  }

  function handleLocaleChange(): void {
    const activeElement = root.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.focusKey
      : undefined;
    render(activeElement);
  }

  function refreshTime(): void {
    const next = new Date();
    if (
      next.getMinutes() !== currentTime.getMinutes() ||
      dayKey(next) !== dayKey(currentTime)
    ) {
      currentTime = next;
      render();
    }
  }

  window.addEventListener("postika:locale-changed", handleLocaleChange);
  const timer = window.setInterval(refreshTime, 15_000);
  render();

  return {
    getDate: () => new Date(selected),
    isValid,
    open() {
      currentTime = new Date();
      if (selected.getTime() <= currentTime.getTime()) {
        selected = new Date(currentTime.getTime() + 5 * 60_000);
        selected.setSeconds(0, 0);
      }
      month = new Date(selected.getFullYear(), selected.getMonth(), 1);
      render();
      root.focus();
    },
    focus() {
      root.focus();
    },
    destroy() {
      window.clearInterval(timer);
      window.removeEventListener("postika:locale-changed", handleLocaleChange);
    },
  };
}
