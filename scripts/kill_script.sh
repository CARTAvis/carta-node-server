#!/bin/bash
# This script is a safe way to allow a user to kill specific commands of other users via sudo
COMMAND_TO_MATCH="carta_backend"

# Gets the child PID of the command (because it is run via sudo)
CHILD_PID=`pgrep -P $1`
# Gets the command name of the process to be killed
COMMAND_OF_PID=`ps -p $CHILD_PID -o comm=`

# Only allow processes with the same command name to be killed
if [ "$COMMAND_OF_PID" == "$COMMAND_TO_MATCH" ]; then
    kill $CHILD_PID
    exit $?
else
    echo "$COMMAND_OF_PID does not match $COMMAND_TO_MATCH"
    exit 1
fi