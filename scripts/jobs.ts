import { closePool } from "../src/lib/db";
import { runJobs } from "../src/domain/jobs";

/** Run scheduled work once (deadlines, auto-confirmation, completion, reminders, email). Schedule via cron. */
runJobs()
  .then((r) => console.log(JSON.stringify(r)))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
