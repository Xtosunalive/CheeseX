"use strict";

const { checkActionAvailability } = require("../action-execution-factory.cjs");

function projectScreenAvailability(screen, { snapshot, classId, params = {}, body = {} } = {}) {
  if (!screen) return null;
  return {
    ...screen,
    buttons: (screen.buttons || []).map((button) => {
      const verdict = checkActionAvailability({
        actionId: button.action_id,
        snapshot,
        body,
        params: { ...params, classId },
      });
      return {
        ...button,
        availability: {
          allowed: verdict.allowed === true,
          reason: verdict.reason ?? null,
        },
      };
    }),
  };
}

module.exports = { projectScreenAvailability };
