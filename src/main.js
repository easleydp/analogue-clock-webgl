import "./style.css";
import { AnalogueClock } from "./analogue-clock.js";

const clockContainer = document.getElementById("clockContainer");

if (clockContainer) {
  const clock = new AnalogueClock(clockContainer, {
    // Your optional customisations
    brand: "Easley",
    logo: {
      svg: new URL("../welsh_dragon_logo.svg", import.meta.url).href,
      colour: "#9C9C9C",
      scaleFactor: 0.00013,
    },
  });
} else {
  console.error("Clock container not found.");
}
