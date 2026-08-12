property serviceStartedByApp : false
property supportPath : ""
property sitePath : ""
property pidPath : ""
property logPath : ""
property browserHelperPath : ""
property pageURL : "http://127.0.0.1:9002/"
property pageOrigin : "http://127.0.0.1:9002"
property healthURL : "http://127.0.0.1:3101/health"

on run
	my preparePaths()
	my startGitDiff()
end run

on reopen
	my preparePaths()
	my startGitDiff()
end reopen

on idle
	return 30
end idle

on quit
	my preparePaths()
	if serviceStartedByApp then my stopGitDiff()
	continue quit
end quit

on preparePaths()
	set supportPath to (POSIX path of (path to application support from user domain)) & "GitDiff"
	set sitePath to supportPath & "/site"
	set pidPath to supportPath & "/GitDiff.pid"
	set logPath to supportPath & "/GitDiff.log"
	set browserHelperPath to sitePath & "/packaging/macos/open-gitdiff.jxa"
end preparePaths

on startGitDiff()
	my preparePaths()
	if (my apiIsHealthy()) and (my webIsListening()) then
		if my warmPage() then
			my showOrRefreshPage()
			return
		end if
	end if

	my stopStaleService()
	set nodeSearchCommand to "NODE_BIN=''; for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do if [ -x \"$candidate\" ]; then NODE_BIN=\"$candidate\"; break; fi; done; if [ -z \"$NODE_BIN\" ]; then NODE_BIN=\"$(command -v node || true)\"; fi; if [ -z \"$NODE_BIN\" ]; then echo 'Node.js 22 or newer is required' >&2; exit 127; fi; "
	set launchCommand to nodeSearchCommand & "/bin/mkdir -p " & quoted form of supportPath & "; cd " & quoted form of sitePath & "; /usr/bin/nohup \"$NODE_BIN\" scripts/dev.mjs > " & quoted form of logPath & " 2>&1 < /dev/null & echo $! > " & quoted form of pidPath
	do shell script launchCommand
	set serviceStartedByApp to true

	set serviceReady to false
	repeat with attempt from 1 to 60
		delay 0.5
		if (my apiIsHealthy()) and (my webIsListening()) then
			set serviceReady to true
			exit repeat
		end if
	end repeat
	if serviceReady and (my warmPage()) then
		my showOrRefreshPage()
		display notification "本地 Git 差异阅读器已启动" with title "GitDiff"
		return
	end if

	display alert "GitDiff 启动失败" message "本地服务未能完成启动或页面预热。可以打开日志查看具体原因。" buttons {"关闭", "查看日志"} default button "查看日志" as critical
	if button returned of result is "查看日志" then do shell script "/usr/bin/open " & quoted form of logPath
end startGitDiff

on showOrRefreshPage()
	try
		do shell script "/usr/bin/osascript -l JavaScript " & quoted form of browserHelperPath & " " & quoted form of pageURL & " " & quoted form of pageOrigin
		return true
	on error
		open location pageURL
		return false
	end try
end showOrRefreshPage

on apiIsHealthy()
	try
		do shell script "/usr/bin/curl --silent --fail --max-time 1 " & quoted form of healthURL & " > /dev/null"
		return true
	on error
		return false
	end try
end apiIsHealthy

on webIsListening()
	try
		do shell script "/usr/bin/nc -z 127.0.0.1 9002"
		return true
	on error
		return false
	end try
end webIsListening

on warmPage()
	try
		do shell script "/usr/bin/curl --silent --fail --max-time 60 " & quoted form of pageURL & " > /dev/null"
		return true
	on error
		return false
	end try
end warmPage

on stopStaleService()
	try
		set oldPid to do shell script "/bin/cat " & quoted form of pidPath & " | /usr/bin/tr -cd '0-9'"
		if oldPid is not "" then do shell script "/bin/kill -TERM " & oldPid & " >/dev/null 2>&1 || true"
	on error
		-- A missing or stale PID file is harmless.
	end try
end stopStaleService

on stopGitDiff()
	my preparePaths()
	try
		set servicePid to do shell script "/bin/cat " & quoted form of pidPath & " | /usr/bin/tr -cd '0-9'"
		if servicePid is not "" then do shell script "/bin/kill -TERM " & servicePid & " >/dev/null 2>&1 || true"
	on error
		-- The service may already have stopped.
	end try
	do shell script "/bin/rm -f " & quoted form of pidPath
end stopGitDiff
