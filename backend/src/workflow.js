export const STATUSES = ["Open", "In Progress", "Awaiting Approval", "Resolved", "Closed"];
const transitions = {
  "Open": ["In Progress"],
  "In Progress": ["Open", "Awaiting Approval"],
  "Awaiting Approval": ["In Progress", "Resolved"],
  "Resolved": ["Closed", "In Progress"],
  "Closed": []
};
export function canTransition(from, to, role) {
  if (!transitions[from]?.includes(to)) return false;
  if (from === "Awaiting Approval" && to === "Resolved") return ["Lead", "Admin"].includes(role);
  return true;
}
