import { closePool } from "../src/server/db";
import { runJobs } from "../src/server/jobs/runner";

/** Run scheduled work once (deadlines, auto-confirmation, completion, reminders, email). Schedule via cron. */
runJobs()
  .then((r) => console.log(JSON.stringify(r)))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
