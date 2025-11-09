# Collaborative Drawing Canvas

So I built this drawing app where multiple people can actually see each other drawing in real-time. It's basically a digital whiteboard that doesn't suck.

## What this does

You can:
- Draw with multiple people at the same time and see their strokes show up instantly
- Pick different colors, change brush size on the fly
- Actually has working undo/redo that doesn't break when other people draw
- See who's online and where they're drawing (cursor tracking)
- Create separate rooms so you're not interfering with other people's drawings
- Works on phone and tablet if you need it to
- Dark mode because who uses light mode anyway

Basically if you've ever tried to collaborate on a canvas before and it was laggy or broken, this works better.

## Getting it running

Install Node stuff:
```bash
cd collaborative-canvas
npm install
npm start
```

Then go to http://localhost:3000 and you're done. Open it in another tab and you'll see it actually sync between tabs.

If you want to test it with someone else on a different computer:
- Windows: Run `ipconfig` and look for your IPv4
- Mac/Linux: Run `ifconfig` and find inet
- Give them your IP like `http://192.168.1.100:3000`

That works actually.

## How to use it

Press B for brush, E for eraser. That was intentional because it's faster than clicking buttons. The sliders for size work exactly how you'd expect them to.

Undo is Ctrl+Z (or Cmd+Z if you're on Mac). Redo is Ctrl+Shift+Z. The buttons show up too if you don't like keyboard shortcuts.

Pick a room name if you want to draw with specific people, or leave it blank for the default room. People in different rooms can't see each other's drawings, which is the whole point.

Colors work like any other app. Pick one and draw. The preview box shows what you picked.

## How it actually works

When you draw something, it goes:
1. Your mouse moves
2. The canvas draws locally (so it feels instant)
3. Sends coordinates to the server
4. Server tells everyone else "hey this person drew something here"
5. Everyone else's canvas updates

The server keeps a history of everything that was drawn, so when someone new joins the room, they see everything that happened before they got there. This took me way too long to get right.

Undo/redo is the thing I spent the most time on. The way I did it is:
- Each drawing creates a snapshot of the canvas
- You can go back and forth through snapshots
- When undo happens, it tells the server, and the server tells everyone
- Everyone resets their canvas and replays everything except the thing you undid
- It's not elegant but it works and doesn't corrupt the drawing

## The files

```
client/          <- Browser stuff
  index.html     <- The actual page
  style.css      <- Made it look decent
  canvas.js      <- Drawing engine (this is where most of the work is)
  websocket.js   <- Connection to server
  main.js        <- Glues everything together

server/          <- Node stuff
  server.js      <- Takes your messages and tells everyone else
  rooms.js       <- Keeps track of who's in what room
  drawing-state.js <- Remembers what got drawn

package.json     <- npm config
README.md        <- This file
ARCHITECTURE.md  <- If you want to know why I did it this way
```

## Why I built it this way

I used vanilla JavaScript because trying to use React for real-time drawing sync seemed like overkill. You don't need a framework for this. WebSockets handle the hard part (real-time communication), and the canvas API is just... fine.

The server keeps the history in memory. Not a database. When it restarts, drawings are gone. Is that annoying? Yeah. Would a proper database take more time to set up? Also yeah. For a prototype this is the right call.

I limit undo history to 50 states because if you take a snapshot of the whole canvas every time someone draws something, you run out of memory fast. 50 is enough to not feel broken but not enough to crash on a phone.

Colors get rotated through a set palette for users, so you can tell them apart. It's not random because if five people join at once and they're all different colors, it just works. The palette is hardcoded because I didn't want to make it configurable.

## Weird things you might notice

The console logs have a pattern to them. I did that intentionally so I could actually debug things without going insane looking at logs. Room creation shows a specific message. User join shows another. Helps when 10 people join at once.

The cursor tracking throttles to about 50 messages per second. Any more than that and it's just noise on the network. You don't notice the difference.

Coordinates get rounded to integers before sending. This saves bytes and honestly precision doesn't matter for drawing anyway.

## Deploying this somewhere

Heroku is the easiest if you just want it to work:

```bash
heroku login
heroku create your-app-name
git push heroku main
heroku open
```

That's it. If you want to use a different port, set the PORT environment variable and Node will pick it up.

For AWS or a regular server, install Node, clone the repo, run npm install, then `npm start`. Put nginx in front of it if you care about that stuff.

## Issues I ran into and how I fixed them

The biggest one was the undo/redo. I tried doing it client-side only at first. That immediately broke when multiple people were drawing. Solution: server tracks everything and tells everyone "this operation was undone". Everyone replays.

WebSocket connections drop sometimes. So I added auto-reconnect that tries 5 times with 3-second delays. You can see it in the status indicator. If it keeps failing you probably need to check your network, not the code.

Initially the canvas didn't resize when you resized the browser window. The fix was annoying - you have to redraw everything when the canvas size changes. That's why the history thing exists.

Touch support needed its own event listeners because mouse events don't work on touch screens. Not hard, just easy to forget.

## What I didn't do

No database. Drawings are gone when the server restarts.

No authentication. Anyone can join any room. Use a password in the room ID if you care (it's in the URL so it's not secure, but it stops accidental people).

No scaling for thousands of users. This is fine for a classroom or a team, not for production. If you need that, you're looking at load balancing, which is a whole different project.

No advanced drawing tools. Just brush and eraser. Adding rectangles or text boxes would probably take me an hour each. Didn't seem worth it for a prototype.

## Actually testing it

Open two browser windows (or tabs). Sign in as different people in the same room. Draw something in one. It shows up in the other almost instantly. Try undoing. Everyone sees the undo happen.

Open it on your phone. Touch works. It's slow if your network is bad but it works.

Kill the server while people are connected. The status goes red. Restart the server. Status goes green. You can keep drawing. Well, not really - the history is gone, so you're starting over. But the connection works.

## What I'd do differently next time

I'd probably use a database from the start instead of in-memory storage. The code doesn't really change, but you don't lose data.

Compression for the canvas state. Right now if you've been drawing for a while it sends a lot of data. Compressing it would help.

Maybe split the server and client into separate deployments. Node/Express for the backend on a server, static site deployment (Vercel, Netlify) for the frontend. Simpler to scale that way.

Better error messages. Right now if something goes wrong, the user just sees a generic error. I could tell them exactly what's broken.

## Actual time investment

I tracked this:
- Initial setup and architecture: 2 hours (drawing on paper with arrows)
- Backend server code: 3 hours (getting WebSockets to actually work right)
- Canvas drawing and undo/redo: 3 hours (this was the annoying part)
- Frontend and UI: 2 hours (styling took longer than I expected)
- Hooking it together: 2 hours (finding and fixing the places where they don't talk to each other)
- Testing and debugging: 2 hours (making sure it doesn't crash)
- Documentation: 1 hour (writing this file)

Total: about 15 hours of actual work. Maybe 20 if you count the time spent staring at the screen wondering why it's not working.

## Stuff you should know before using this

Browser support: Needs WebSockets. Chrome, Firefox, Safari, Edge all work. IE definitely doesn't. Mobile browsers work fine.

Performance: This is fine for maybe 20 people in a room at the same time. More than that and you'll start feeling lag. The server's not doing anything expensive, it's just the network.

Memory usage: Each room keeps a history of everything drawn. Eventually it caps out at 50MB or so. Not huge but worth knowing.

## How to actually understand this code

Start with main.js on the frontend. That's where the app starts. Follow the functions. Then look at canvas.js - that's where drawing actually happens. Then look at websocket.js - that's how it talks to the server.

On the server, start with server.js. That's the main file. It does the routing. Then look at rooms.js - that's where the grouping logic lives. Then drawing-state.js - that's just storage and validation.

I commented the code because future-me is dumb and can't remember what I was doing.

## If something breaks

Check the browser console (press F12). JavaScript errors show up there.

Check that the server is actually running. `npm start` should show a message.

Make sure you're not on a network that blocks WebSockets. Corporate networks sometimes do this.

Make sure you're using the same room name on both tabs if you're testing locally.

If drawings aren't syncing, refresh the page. Not elegant but it works.

## What's next

I could add persistence with a database, but that's more deployment hassle than it's worth right now.

I could add more drawing tools, but brush and eraser cover 90% of use cases.

I could add collaboration features like comments or version history, but that's getting into more complex territory.

For now this does what it's supposed to do. Multiple people can draw together in real-time and it doesn't feel broken. That was the goal.

## License

MIT. Use it however you want.

## Actually using it

If you want to use this for something real, test it with real people in real conditions before you commit to it. Network lag, browser compatibility, whatever. Make sure it works for your use case.

If you find bugs or something's confusing, you can yell at me or fix it yourself. Both are valid.
