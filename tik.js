// Zegar hosta w osobnym wątku: timery workera nie zwalniają, kiedy karta gry jest schowana w tle.
setInterval(() => postMessage(0), 100);
