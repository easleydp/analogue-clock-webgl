import "./style.css";
import { AnalogueClock } from "./analogue-clock.js";

const clockContainer = document.getElementById("clockContainer");

if (clockContainer) {
  const clock = new AnalogueClock(clockContainer, { brand: "Easley" });
} else {
  console.error("Clock container not found.");
}
