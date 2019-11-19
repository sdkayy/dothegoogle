const puppeteer = require("puppeteer");
const Twit = require("twit");
const fs = require("fs");
const bw = require("bad-words");
const uuid = require("uuid/v4");
const bwFilter = new bw();
require("dotenv").config();

// Configure badword filter.
if (process.env.BLACK_LIST)
  bwFilter.addWords(process.env.BLACK_LIST.split(","));

const T = new Twit({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token: process.env.ACCESS_TOKEN,
  access_token_secret: process.env.ACCESS_SECRET
});

const stream = T.stream("statuses/filter", {
  track: process.env.TRACKER_STRINGS.split(",")
});

const replaceFiltersAndClean = query => {
  const filters = process.env.TRACKER_STRINGS.split(",");
  for (var i = 0; i < filters.length; i++) {
    query = query.replace(filters[i], "");
  }
  return bwFilter
    .clean(query)
    .split(" ")
    .join("+")
    .toLowerCase();
};

stream.on("tweet", async function(tweet) {
  const { id_str, text, user } = tweet;
  // Hardcoded our bots username for now. Prevent a stupid loop lol.
  if (user.screen_name === process.env.OUR_ACCOUNT_NAME) {
    return;
  }
  const query = replaceFiltersAndClean(text);
  // Temp file name for easy storage.
  const tempFileName = `./data/${uuid()}.png`;
  // Query Google, Start puppeteer and save a screenshot of the google card.
  await queryGoogle(query, tempFileName);
  try {
    const b64content = fs.readFileSync(tempFileName, { encoding: "base64" });
    // Post our photo to twitter,
    T.post(
      "media/upload",
      { media_data: b64content, in_reply_to_status_id: id_str },
      function(err, data, response) {
        // alt text etc.
        // TODO: OCR the photo as alt text???
        const mediaIdStr = data.media_id_string;
        const altText = `Google suggested result for the query "${query}"`;
        const meta_params = {
          media_id: mediaIdStr,
          alt_text: { text: altText },
          in_reply_to_status_id: id_str
        };

        // Post metadata to photo.
        T.post("media/metadata/create", meta_params, function(
          err,
          data,
          response
        ) {
          if (!err) {
            // Attach photo, and reply to the mentioning tweet.
            const params = {
              status: `@${user.screen_name} This is what we found on Google`,
              media_ids: [mediaIdStr],
              in_reply_to_status_id: id_str
            };
            // Finally reply.
            T.post("statuses/update", params, function(err, data, response) {
              console.log("Answered query");
              if (process.env.DELETE_WHEN_DONE) {
                fs.unlinkSync(tempFileName);
              }
            });
          }
        });
      }
    );
  } catch (e) {
    const params = {
      status: `@${user.screen_name} Sorry! We ran into an issue! @${process.env.PANIC_USERNAME} FIX ME!`,
      in_reply_to_status_id: id_str
    };
    T.post("statuses/update", params, function(err, data, response) {
      console.log("Failed", e);
    });
  }
});

const queryGoogle = async (query, fileName) => {
  try {
    const browser = await puppeteer.launch();

    const page = await browser.newPage();
    await page.goto(`https://google.com/search?q=${query}`);
    await page.setViewport({
      width: 800,
      height: 1000
    });

    const example = await page.$(".g");
    const bounding_box = await example.boundingBox();

    await example.screenshot({
      path: fileName,
      clip: {
        x: bounding_box.x - 40,
        y: bounding_box.y - 20,
        width: Math.min(bounding_box.width, page.viewport().width) + 80,
        height: Math.min(bounding_box.height, page.viewport().height) + 40
      }
    });
    await browser.close();
  } catch (e) {
    // Add logging??
    console.log({
      ...e,
      query,
      fileName
    });
  }
};
