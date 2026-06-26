// ABOUTME: Pure grouping of scored earthquakes into descending priority
// ABOUTME: buckets so the highest-priority alert drives the response message.

/**
 * Groups scored earthquakes into non-empty buckets ordered from highest
 * priority (2) to lowest (0). The first bucket is the most urgent, so callers
 * can use it to drive the returned/most-important alert message.
 * @param {Array<{alertPriority: number}>} earthquakes Scored earthquakes.
 * @return {Array<{priority: number, earthquakes: Array}>} Ordered buckets.
 */
function groupByPriority(earthquakes) {
  const groups = [];
  for (let priority = 2; priority >= 0; priority--) {
    const members = earthquakes.filter((eq) => eq.alertPriority === priority);
    if (members.length > 0) {
      groups.push({priority, earthquakes: members});
    }
  }
  return groups;
}

module.exports = {groupByPriority};
