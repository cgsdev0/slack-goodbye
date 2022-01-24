# slack-goodbye
Automating farewell emails via Slack history.

## Background
I wasn't sure who I should send my goodbye email to, since I've worked with a lot of people 
over the years. I decided to write a script to query my Slack DM history and generate a list 
of email addresses of coworkers I have chatted with before on Slack.

## Dependencies
```
nodejs 17+
npm
fzf
jq
```

## Running it
Run `node index.js` in a terminal. You will be prompted for your slack cookie (can grab from 
chrome network inspector tab) and a token (grabbed from the chrome JS console in a slack window).
After that, it should Just Work:tm:

## Disclaimer
This script relies on internal Slack APIs, and also contains a few things hardcoded for this particular slack instance. 
This prooobably won't work out of the box. YMMV.
