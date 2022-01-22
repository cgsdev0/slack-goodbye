import fetch from "node-fetch";
import cliProgress from "cli-progress";
import colors from "ansi-colors";
import clipboard from "clipboardy";
import child_process from "child_process";
import fs from "fs";
import * as readline from "node:readline/promises";

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(arr, perChunk) {
  return arr.reduce((all, one, i) => {
    const ch = Math.floor(i / perChunk);
    all[ch] = [].concat(all[ch] || [], one);
    return all;
  }, []);
}

async function retry(retries, fn, ...args) {
  // prettier-ignore
  while (retries --> 0) {
    try {
      return await fn(...args);
    } catch (e) {
      if (retries) {
        console.warn(colors.yellow("Something failed, retrying..."));
        await timeout(5000);
      } else throw e;
    }
  }
}

const getSecrets = async () => {
  if (fs.existsSync("secrets.json")) {
    return JSON.parse(fs.readFileSync("secrets.json").toString());
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const slackCookie = await rl.question(
    colors.green("Paste your slack cookie string: ")
  );
  console.log(
    "Paste the following into your console for slack:\n",
    colors.yellow(
      "JSON.parse(localStorage.getItem('localConfig_v2')).teams['T02389LUWTG'].token"
    )
  );
  const token = await rl.question(colors.green("Paste the result: "));
  const res = { slackCookie, token };
  rl.close();
  fs.writeFileSync("secrets.json", JSON.stringify(res));
  return res;
};

(async function () {
  try {
    await (async function () {
      const { slackCookie, token } = await getSecrets();

      const imListResp = await fetch(
        "https://samsara-net.slack.com/api/im.list",
        {
          headers: {
            "content-type":
              "multipart/form-data; boundary=----WebKitFormBoundarysTRq47tAYQYMxAm2",
            cookie: slackCookie,
          },
          body: `------WebKitFormBoundarysTRq47tAYQYMxAm2\r\nContent-Disposition: form-data; name=\"get_latest\"\r\n\r\ntrue\r\n------WebKitFormBoundarysTRq47tAYQYMxAm2\r\nContent-Disposition: form-data; name=\"get_read_state\"\r\n\r\ntrue\r\n------WebKitFormBoundarysTRq47tAYQYMxAm2\r\nContent-Disposition: form-data; name=\"token\"\r\n\r\n${token}\r\n------WebKitFormBoundarysTRq47tAYQYMxAm2\r\nContent-Disposition: form-data; name=\"_x_reason\"\r\n\r\nrecent-conversations\r\n------WebKitFormBoundarysTRq47tAYQYMxAm2\r\nContent-Disposition: form-data; name=\"_x_mode\"\r\n\r\nonline\r\n------WebKitFormBoundarysTRq47tAYQYMxAm2\r\nContent-Disposition: form-data; name=\"_x_sonic\"\r\n\r\ntrue\r\n------WebKitFormBoundarysTRq47tAYQYMxAm2--\r\n`,
          method: "POST",
        }
      );

      const result = await imListResp.json();
      if (!result.ok) throw new Error(JSON.stringify(result));
      const userIdList = result.ims
        .filter((im) => im.latest)
        .map((im) => im.user);

      const progressBar = new cliProgress.SingleBar({
        format:
          "Fetching profiles... |" +
          colors.cyan("{bar}") +
          "| {percentage}% | {value}/{total}",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
        hideCursor: true,
      });

      progressBar.start(userIdList.length, 0, {});
      await timeout(1000);

      const getProfileBatchById = async (batch) => {
        const updated_ids = {};
        batch.forEach((userId) => {
          updated_ids[userId] = 0;
        });
        const resp = await fetch(
          "https://edgeapi.slack.com/cache/E01HFLBQTB7/T03SBQS4M/users/info",
          {
            headers: {
              "content-type":
                "multipart/form-data; boundary=----WebKitFormBoundary3kEWa1OCsGJGIhvf",
              cookie: slackCookie,
            },
            body: JSON.stringify({
              token,
              check_interaction: true,
              updated_ids,
            }),
            method: "POST",
          }
        );
        const result = await resp.json();
        if (!result.ok) throw new Error(JSON.stringify(result));
        return result;
      };

      const userData = {};

      const downloadUserData = async (batch) => {
        const [res] = await Promise.all([
          getProfileBatchById(batch),
          timeout(500),
        ]);
        if (!res.ok) throw new Error(JSON.stringify(results));
        res.results.forEach((result) => {
          userData[result.id] = result;
        });

        return res.results.length;
      };

      const batches = chunkArray(userIdList, 20);
      for (const batch of batches) {
        const count = await retry(3, downloadUserData, batch);
        progressBar.increment(count);
      }
      progressBar.stop();

      let filteredUsers = Object.keys(userData)
        .map((id) => userData[id])
        .filter((user) => !user.deleted);

      const getDepartment = (user) =>
        user.profile.fields ? user.profile.fields["Xf013A91570D"].value : null;

      const departments = {};
      filteredUsers.forEach((user) => {
        const dept = getDepartment(user) || "Unknown";
        departments[dept] = (departments[dept] || []).concat(user.real_name);
      });
      let output = "";
      try {
        fs.writeFileSync("departments.json", JSON.stringify(departments));
        child_process.spawnSync(
          "bash",
          [
            "-c",
            "jq -r 'keys | .[]' departments.json | sort | fzf -m --preview='jq -r \".[\\\"$(echo {})\\\"] | .[]\" departments.json' --prompt='Exclude? ' > choices.txt",
          ],
          { stdio: "inherit" }
        );
        output = fs.readFileSync("choices.txt").toString();
      } catch (e) {
        console.warn(colors.yellow("Skipping department filtering."));
      }

      const excludedDepartments = output.split("\n").filter((a) => a);

      filteredUsers = filteredUsers.filter(
        (user) => !excludedDepartments.includes(getDepartment(user))
      );

      const emailList = filteredUsers
        .map((user) => user.profile.email)
        .filter((a) => a);

      console.log(
        `Filtered ${userIdList.length} total users down to ${emailList.length} users.`
      );

      clipboard.writeSync(emailList.join(","));
      console.log("Wrote email list to your clipboard.");
    })();
  } catch (e) {
    fs.unlinkSync("secrets.json");
    throw e;
  }
})();
